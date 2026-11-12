(() => {
    const cards = [];

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
            try {
                if (child._bin && child._bgManager) {
                    const box = child.get_allocation_box();
                    cards.push({
                        binOpacity: child._bin.opacity,
                        visible: child.visible,
                        mapped: child.is_mapped(),
                        allocation: [
                            box.x1,
                            box.y1,
                            box.get_width(),
                            box.get_height(),
                        ],
                    });
                }
                walk(child);
            } catch {
                // Actor was destroyed while walking.
            }
        }
    };

    walk(Main.layoutManager.overviewGroup);

    const demo = Main.extensionManager.lookup('bin-opacity-demo@local');

    return JSON.stringify({
        overviewVisible: Main.overview.visible,
        sessionMode: Main.sessionMode.currentMode,
        userDataDir: global.userdatadir,
        allowExtensionInstallation:
            global.settings.get_boolean('allow-extension-installation'),
        enabledExtensions: global.settings.get_strv('enabled-extensions'),
        extensionUuids: Main.extensionManager.getUuids(),
        demoState: demo ? demo.state : null,
        demoHiddenCount: globalThis.__binOpacityDemo
            ? globalThis.__binOpacityDemo.hiddenCount()
            : null,
        cardCount: cards.length,
        cards,
    }, null, 2);
})()
