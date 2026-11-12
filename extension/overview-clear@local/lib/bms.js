import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import {
    BMS_UUID,
    BMS_OVERVIEW_GROUP_NAME,
    DEFAULT_CORNER_RADIUS,
} from './constants.js';

const BMS_OVERVIEW_SCHEMA = 'org.gnome.shell.extensions.blur-my-shell.overview';

/**
 * Small compatibility layer for Blur My Shell.
 *
 * We deliberately do not import any Blur My Shell modules. The only things we
 * rely on are:
 *  - the extension being ACTIVE,
 *  - its public GSettings schema (blur, workspace-corner-radius),
 *  - the name of its overview background group.
 */
export class BmsHelper {
    constructor() {
        this._settings = null;
        this._settingsSignals = [];
        this.onChanged = null;

        this._active = false;
        this._blurActive = false;
        this._cornerRadius = DEFAULT_CORNER_RADIUS;

        this.refresh();
    }

    get active() {
        return this._active;
    }

    get blurActive() {
        return this._blurActive;
    }

    get cornerRadius() {
        return this._cornerRadius;
    }

    refresh() {
        this._disconnectSettings();

        const extension = Main.extensionManager.lookup(BMS_UUID);
        this._active =
            extension !== undefined &&
            extension !== null &&
            extension.enabled === true &&
            extension.state === ExtensionState.ACTIVE &&
            extension.dir !== undefined &&
            extension.dir !== null;

        if (!this._active) {
            this._blurActive = false;
            this._cornerRadius = DEFAULT_CORNER_RADIUS;
            return;
        }

        let source = Gio.SettingsSchemaSource.get_default();
        const schemaDir = extension.dir.get_child('schemas');

        if (schemaDir.query_exists(null)) {
            try {
                source = Gio.SettingsSchemaSource.new_from_directory(
                    schemaDir.get_path(), source, false);
            } catch (error) {
                console.warn(`[overview-clear] Failed to read Blur My Shell schemas: ${error}`);
            }
        }

        const schema = source.lookup(BMS_OVERVIEW_SCHEMA, true);
        if (!schema) {
            this._blurActive = false;
            this._cornerRadius = DEFAULT_CORNER_RADIUS;
            return;
        }

        try {
            this._settings = Gio.Settings.new_full(schema, null, null);
        } catch (error) {
            console.warn(`[overview-clear] Failed to open Blur My Shell settings: ${error}`);
            this._blurActive = false;
            this._cornerRadius = DEFAULT_CORNER_RADIUS;
            return;
        }

        this._readSettings();

        for (const key of ['blur', 'workspace-corner-radius']) {
            this._settingsSignals.push(this._settings.connect(`changed::${key}`, () => {
                this._readSettings();
                this.onChanged?.();
            }));
        }
    }

    _readSettings() {
        if (!this._settings) {
            this._blurActive = false;
            this._cornerRadius = DEFAULT_CORNER_RADIUS;
            return;
        }

        try {
            this._blurActive = this._settings.get_boolean('blur');
            this._cornerRadius = this._settings.get_int('workspace-corner-radius');
        } catch (error) {
            // Schema changed between versions or the settings backend failed.
            console.warn(`[overview-clear] Failed to read Blur My Shell settings: ${error}`);
            this._blurActive = false;
            this._cornerRadius = DEFAULT_CORNER_RADIUS;
            return;
        }

        if (!Number.isFinite(this._cornerRadius) || this._cornerRadius < 0)
            this._cornerRadius = DEFAULT_CORNER_RADIUS;
    }

    _disconnectSettings() {
        if (this._settings) {
            for (const id of this._settingsSignals) {
                try {
                    this._settings.disconnect(id);
                } catch {
                    // The settings object may already be gone.
                }
            }
        }

        this._settingsSignals = [];
        this._settings = null;
    }

    /**
     * @returns {Clutter.Actor|null} Blur My Shell's overview background group.
     */
    findOverviewBackgroundGroup() {
        const overviewGroup = Main.layoutManager.overviewGroup;
        if (!overviewGroup)
            return null;

        return overviewGroup.get_children().find(
            child => child.name === BMS_OVERVIEW_GROUP_NAME) ?? null;
    }

    destroy() {
        this._disconnectSettings();
        this.onChanged = null;
    }
}
