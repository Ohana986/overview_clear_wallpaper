import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ControlsState} from 'resource:///org/gnome/shell/ui/overviewControls.js';
import {
    WorkspaceBackground,
} from 'resource:///org/gnome/shell/ui/workspace.js';
import {
    WorkspacesDisplay,
    WorkspacesView,
} from 'resource:///org/gnome/shell/ui/workspacesView.js';

import {BmsHelper} from './bms.js';
import {CardRegistry} from './cardRegistry.js';
import {BMS_UUID, DEBUG, DEFAULT_CORNER_RADIUS} from './constants.js';

/**
 * Coordinates:
 *  - Blur My Shell detection,
 *  - workspace card registration and the native wallpaper crop,
 *  - switching between the sharp crop and the native app grid wallpaper.
 *
 * There is no extra wallpaper actor and no shader mask: each card's own
 * Meta.BackgroundActor is resized and positioned to show the screen-aligned
 * 1:1 crop. Rendering cost therefore stays close to the native overview.
 */
export class OverviewClearManager {
    constructor(extension) {
        this._extension = extension;
        this._enabled = false;

        this._bms = null;
        this._registry = null;

        this._connections = [];
        this._controls = null;
        this._controlsConnections = [];
        this._hooks = [];
        this._laterId = 0;

        this._settings = null;
        this._settingsId = 0;
        // Default to the native app grid even if the schema is unavailable.
        this._appGridNative = true;
    }

    enable() {
        if (this._enabled)
            return;

        this._enabled = true;

        try {
            this._enableInternal();
        } catch (error) {
            // Roll back partial setup so a failed enable cannot leave hooks
            // or signal handlers behind.
            this.disable();
            throw error;
        }
    }

    _enableInternal() {
        this._bms = new BmsHelper();
        this._bms.onChanged = () => this._onBmsChanged();

        this._registry = new CardRegistry(this);
        this._initSettings();
        this._installHooks();

        this._connect(Main.overview, 'showing', () => this._onOverviewShowing());
        this._connect(Main.overview, 'shown', () => this.scheduleUpdate());
        this._connect(Main.overview, 'hiding', () => this.scheduleUpdate());

        // The stage emits before-paint after the layout phase and before the
        // frame is drawn. The crop must be recomputed there: BEFORE_REDRAW
        // runs before layout, so a workspace scroll would otherwise leave the
        // wallpaper one frame behind the card. Mode switches stay in the
        // BEFORE_REDRAW callback so they still happen before layout.
        this._connect(global.stage, 'before-paint', () => {
            if (Main.overview.visible)
                this._registry?.update();
        });

        this._connect(Main.layoutManager, 'monitors-changed',
            () => this.scheduleUpdate());
        this._connect(global.display, 'workareas-changed',
            () => this.scheduleUpdate());
        this._connect(Main.layoutManager, 'startup-complete', () => {
            if (DEBUG)
                console.log('[overview-clear] startup-complete');
            this._registry?.scan();
            this.scheduleUpdate();
        });

        this._connect(Main.extensionManager, 'extension-state-changed',
            (_manager, extension) => {
                if (extension?.uuid === BMS_UUID)
                    this._onBmsChanged();
            });

        this._connect(global.workspace_manager, 'notify::n-workspaces', () => {
            this._registry?.scan();
            this.scheduleUpdate();
        });

        // Clean up if the shell goes away while we are enabled.
        this._connect(Main.uiGroup, 'destroy', () => this.disable());

        this._registry.scan();

        this._connectControls();

        // The overview may already be open when the extension is enabled
        // (for example after `gnome-extensions enable`). Apply the current
        // view mode immediately instead of waiting for the next signal.
        this.scheduleUpdate();

        if (DEBUG)
            console.log(`[overview-clear] enabled; monitors=${Main.layoutManager.monitors.length}`);
    }

    disable() {
        if (!this._enabled)
            return;

        this._enabled = false;

        if (this._laterId) {
            try {
                global.compositor.get_laters().remove(this._laterId);
            } catch {
                // The compositor may already be gone.
            }
            this._laterId = 0;
        }

        this._disconnectAll();
        this._disconnectControls();
        this._disconnectSettings();

        this._restoreHooks();

        this._registry?.destroy();
        this._registry = null;

        this._bms?.destroy();
        this._bms = null;

        this._controls = null;
    }

    _initSettings() {
        try {
            this._settings = this._extension.getSettings();
        } catch (error) {
            // The schema is installed together with the extension. Keep the
            // wallpaper feature usable if it is missing or unreadable.
            console.warn(`[overview-clear] Settings unavailable: ${error}`);
            this._settings = null;
        }

        if (!this._settings)
            return;

        this._appGridNative = this._readAppGridNative();

        try {
            this._settingsId = this._settings.connect(
                'changed::app-grid-native-wallpaper', () => {
                    this._appGridNative = this._readAppGridNative();
                    this.scheduleUpdate();
                });
        } catch (error) {
            console.warn(`[overview-clear] Could not watch settings: ${error}`);
        }
    }

    _readAppGridNative() {
        try {
            return this._settings?.get_boolean('app-grid-native-wallpaper') ??
                true;
        } catch {
            return true;
        }
    }

    _disconnectSettings() {
        if (this._settings && this._settingsId) {
            try {
                this._settings.disconnect(this._settingsId);
            } catch {
                // Settings object may already be disposed.
            }
        }

        this._settingsId = 0;
        this._settings = null;
    }

    /**
     * How much of the native workspace card wallpaper should be visible.
     *
     * 0 means the window picker: the card shows the screen-aligned 1:1
     * wallpaper crop. 1 means the app grid: the card shows its own scaled
     * wallpaper again. The crop is kept for the whole transition and is only
     * dropped once the app grid is fully settled.
     */
    _getAppGridNativeAmount() {
        if (!this._appGridNative)
            return 0;

        const adjustment = this._controls?._stateAdjustment;
        if (!adjustment)
            return 0;

        let params;
        try {
            params = adjustment.getStateTransitionParams();
        } catch {
            return 0;
        }

        const {initialState, finalState, progress} = params;
        const appGrid = ControlsState.APP_GRID;

        if (initialState === appGrid && finalState === appGrid)
            return 1;

        if (initialState === appGrid)
            return Math.max(0, Math.min(1, 1 - progress));

        if (finalState === appGrid)
            return Math.max(0, Math.min(1, progress));

        return 0;
    }

    getCornerRadius() {
        if (this._bms?.blurActive)
            return this._bms.cornerRadius;

        return DEFAULT_CORNER_RADIUS;
    }

    _onOverviewShowing() {
        this._registry?.scan();
        this._connectControls();
        this.scheduleUpdate();
    }

    _onBmsChanged() {
        if (!this._enabled)
            return;

        this._bms?.refresh();
        // The corner radius comes from Blur My Shell; rescan so the crop
        // radius is re-applied consistently.
        this._registry?.scan();
        this.scheduleUpdate();
    }

    _connectControls() {
        const controls = Main.overview?._overview?._controls ?? null;

        if (!controls || controls === this._controls)
            return;

        this._disconnectControls();
        this._controls = controls;

        const schedule = () => this.scheduleUpdate();

        this._connectControlSignal(controls._stateAdjustment, 'notify::value', schedule);
        this._connectControlSignal(controls._workspacesDisplay, 'notify::opacity', schedule);
        this._connectControlSignal(controls._workspacesDisplay, 'notify::visible', schedule);
        this._connectControlSignal(controls, 'notify::opacity', schedule);
    }

    _connectControlSignal(object, signal, callback) {
        if (!object)
            return;

        try {
            this._controlsConnections.push([object, object.connect(signal, callback)]);
        } catch {
            // Object may be gone already.
        }
    }

    _disconnectControls() {
        for (const [object, id] of this._controlsConnections) {
            try {
                object.disconnect(id);
            } catch {
                // Object may be gone already.
            }
        }

        this._controlsConnections = [];
        this._controls = null;
    }

    _connect(object, signal, callback) {
        if (!object)
            return;

        try {
            this._connections.push([object, object.connect(signal, callback)]);
        } catch {
            // Signal target may be unavailable.
        }
    }

    _disconnectAll() {
        for (const [object, id] of this._connections) {
            try {
                object.disconnect(id);
            } catch {
                // Object may be gone already.
            }
        }

        this._connections = [];
    }

    scheduleUpdate() {
        if (!this._enabled)
            return;

        if (this._laterId)
            return;

        this._laterId = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => {
                this._laterId = 0;
                this._update();
                return GLib.SOURCE_REMOVE;
            });
    }

    _update() {
        if (!this._enabled)
            return;

        const nativeAmount = this._getAppGridNativeAmount();
        this._registry?.setNativeAmount(nativeAmount);

        // While the overview is visible the stage's before-paint callback
        // refreshes the geometry after layout. Only seed it here when the
        // overview is hidden and no before-paint frame is expected.
        if (nativeAmount < 1 && !Main.overview.visible)
            this._registry?.update();
    }

    _installHooks() {
        const manager = this;
        const registry = this._registry;

        const wrap = (prototype, name, after) => {
            const original = prototype[name];

            if (typeof original !== 'function' || original.__overviewClearWrapped)
                return;

            const wrapper = function (...args) {
                const result = original.apply(this, args);
                try {
                    after.call(this);
                } catch (error) {
                    console.warn(`[overview-clear] Hook ${name} failed: ${error}`);
                }
                return result;
            };

            wrapper.__overviewClearWrapped = true;
            prototype[name] = wrapper;
            this._hooks.push({prototype, name, original, wrapper});
        };

        try {
            wrap(WorkspaceBackground.prototype, '_init', function () {
                registry.register(this);
                manager.scheduleUpdate();
            });

            wrap(WorkspacesDisplay.prototype, '_updateWorkspacesViews', function () {
                registry.scan();
                manager.scheduleUpdate();
            });

            wrap(WorkspacesView.prototype, '_updateWorkspaces', function () {
                registry.scan();
                manager.scheduleUpdate();
            });
        } catch (error) {
            // Never leave a partially installed hook set behind if the shell
            // prototype changes: enable() would abort and disable() would not
            // necessarily run.
            this._restoreHooks();
            throw error;
        }
    }

    _restoreHooks() {
        for (const {prototype, name, original, wrapper} of this._hooks) {
            if (prototype[name] === wrapper)
                prototype[name] = original;
        }

        this._hooks = [];
    }
}
