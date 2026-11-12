// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ohana986

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {OverviewClearManager} from './lib/manager.js';

export default class OverviewClearExtension extends Extension {
    enable() {
        this._manager = new OverviewClearManager(this);
        this._manager.enable();
    }

    disable() {
        if (this._manager) {
            this._manager.disable();
            this._manager = null;
        }
    }
}
