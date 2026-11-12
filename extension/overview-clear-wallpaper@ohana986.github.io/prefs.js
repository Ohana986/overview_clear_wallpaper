// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ohana986

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class OverviewClearPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Keep a reference for as long as the window exists; the GSettings
        // binding alone does not guarantee the object outlives this method.
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: _('Overview'),
            icon_name: 'preferences-desktop-screensaver-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('App Grid'),
        });

        const row = new Adw.SwitchRow({
            title: _('Use the system wallpaper'),
            subtitle: _("The app grid uses the system's native workspace card wallpaper instead of this extension's screen-aligned sharp wallpaper. When disabled, the strip at the top of the app grid also shows the sharp wallpaper; the window picker and the rest of the overview always use it."),
        });

        settings.bind('app-grid-native-wallpaper', row, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        group.add(row);
        page.add(group);
        window.add(page);
    }
}
