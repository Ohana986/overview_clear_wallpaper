/*
 * Minimal demo for GNOME Shell 50.
 *
 * What it does:
 *   - WorkspaceBackground creates an inner Clutter.Actor named `_bin`
 *     which contains the wallpaper background group.
 *   - This extension sets `_bin.opacity = 0` for every workspace card.
 *   - Nothing else is changed: no sharp wallpaper layer, no mask, no
 *     Blur My Shell modification.
 *
 * Expected result:
 *   - The card's own scaled wallpaper disappears.
 *   - The card becomes transparent and only its St box-shadow remains.
 *   - With Blur My Shell enabled, the BMS overview background shows
 *     through the card. Without BMS, `#222226` shows through.
 *
 * Notes:
 *   - Workspace views are recreated every time the overview is shown.
 *     Hooking WorkspaceBackground._init covers future instances, and a
 *     scan on `Main.overview::showing` covers the current ones.
 *   - Only `_bin.opacity` is touched. `_bgManager`, `_backgroundGroup`
 *     and the widget itself stay alive, so Blur My Shell's
 *     `_updateBorderRadius` prototype patch keeps working.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {WorkspaceBackground} from 'resource:///org/gnome/shell/ui/workspace.js';
import {WorkspacesDisplay} from 'resource:///org/gnome/shell/ui/workspacesView.js';

const LOG_PREFIX = '[bin-opacity-demo]';

export default class BinOpacityDemoExtension extends Extension {
    enable() {
        this._backgrounds = new Map(); // WorkspaceBackground -> original _bin.opacity
        this._signals = [];
        this._hooks = [];
        this._loggedFirstCard = false;

        this._installHooks();

        this._connect(Main.overview, 'showing', () => {
            this._scan();
            console.log(`${LOG_PREFIX} overview showing; hidden cards=${this._backgrounds.size}`);
        });

        this._connect(Main.overview, 'shown', () => {
            this._scan();
        });

        this._scan();

        // Handy for Looking Glass and for the headless smoke test.
        globalThis.__binOpacityDemo = {
            hiddenCount: () => this._backgrounds.size,
            scan: () => {
                this._scan();
                return this._backgrounds.size;
            },
        };

        console.log(`${LOG_PREFIX} enabled`);
    }

    disable() {
        this._restoreHooks();
        this._disconnectAll();

        for (const [background, opacity] of this._backgrounds) {
            try {
                if (background._bin)
                    background._bin.opacity = opacity;
            } catch {
                // The actor was already destroyed.
            }
        }

        this._backgrounds.clear();

        if (globalThis.__binOpacityDemo)
            delete globalThis.__binOpacityDemo;

        console.log(`${LOG_PREFIX} disabled`);
    }

    _installHooks() {
        const demo = this;

        const wrap = (prototype, name, after) => {
            const original = prototype[name];
            if (typeof original !== 'function' || original.__binOpacityDemoWrapped)
                return;

            const wrapper = function (...args) {
                const result = original.apply(this, args);
                try {
                    after.call(this);
                } catch (error) {
                    console.warn(`${LOG_PREFIX} hook ${name} failed: ${error}`);
                }
                return result;
            };

            wrapper.__binOpacityDemoWrapped = true;
            prototype[name] = wrapper;
            this._hooks.push({prototype, name, original, wrapper});
        };

        wrap(WorkspaceBackground.prototype, '_init', function () {
            demo._hideBackground(this);
        });

        // Safety net: _updateWorkspacesViews destroys and recreates all
        // workspace views when the overview is entered.
        wrap(WorkspacesDisplay.prototype, '_updateWorkspacesViews', function () {
            demo._scan();
        });
    }

    _restoreHooks() {
        for (const {prototype, name, original, wrapper} of this._hooks) {
            if (prototype[name] === wrapper)
                prototype[name] = original;
        }
        this._hooks = [];
    }

    _hideBackground(background) {
        if (!background || !background._bin)
            return;

        if (!this._backgrounds.has(background)) {
            this._backgrounds.set(background, background._bin.opacity);
            if (!this._loggedFirstCard) {
                this._loggedFirstCard = true;
                console.log(`${LOG_PREFIX} hiding wallpaper via _bin.opacity = 0`);
            }
        }

        if (background._bin.opacity !== 0)
            background._bin.opacity = 0;
    }

    _scan() {
        const overviewGroup = Main.layoutManager?.overviewGroup;
        if (!overviewGroup)
            return;

        const walk = actor => {
            if (!actor)
                return;

            let children;
            try {
                children = actor.get_children();
            } catch {
                return;
            }

            for (const child of children) {
                if (child instanceof WorkspaceBackground)
                    this._hideBackground(child);
                else
                    walk(child);
            }
        };

        walk(overviewGroup);
    }

    _connect(object, signal, callback) {
        try {
            this._signals.push([object, object.connect(signal, callback)]);
        } catch {
            // Object is already gone.
        }
    }

    _disconnectAll() {
        for (const [object, id] of this._signals) {
            try {
                object.disconnect(id);
            } catch {
                // Object is already gone.
            }
        }
        this._signals = [];
    }
}
