// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Ohana986

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class OverviewClearPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Keep a reference for as long as the window exists; the GSettings
        // binding alone does not guarantee the object outlives this method.
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: '概览',
            icon_name: 'preferences-desktop-screensaver-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: '应用网格',
        });

        const row = new Adw.SwitchRow({
            title: '使用系统默认壁纸',
            subtitle: '应用网格页面使用系统原生的卡片壁纸，而不是本扩展的屏幕对齐清晰壁纸。' +
                '关闭后，应用网格顶部的窄条也会显示清晰壁纸；' +
                '窗口选择器和概览的其他部分始终使用清晰壁纸。',
        });

        settings.bind('app-grid-native-wallpaper', row, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        group.add(row);
        page.add(group);
        window.add(page);
    }
}
