(() => {
    const stream = Gio.MemoryOutputStream.new_resizable();
    const loop = GLib.MainLoop.new(null, false);
    let result = 'pending';

    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => {
        result = 'timeout waiting for screenshot';
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });

    const screenshot = new Shell.Screenshot();

    screenshot.screenshot(false, stream, (obj, res) => {
        try {
            const [ok, area] = screenshot.screenshot_finish(res);
            stream.close(null);
            const bytes = stream.steal_as_bytes();
            const base = GLib.getenv('TEST_HOME') ?? '/tmp';
            const index = globalThis.__overviewClearShotIndex;
            const name = index === 2 ? 'overview-noeffect.png'
                : index === 3 ? 'overview-appgrid.png'
                : index === 4 ? 'overview-disabled.png'
                : index === 5 ? 'overview-reenabled.png'
                : index === 6 ? 'overview-native.png'
                : index === 7 ? 'overview-testrect.png'
                : index === 8 ? 'overview-noshadow.png'
                : index === 9 ? 'desktop.png'
                : index === 10 ? 'overview-appgrid-native.png'
                : index === 11 ? 'overview-appgrid-disabled.png'
                : index === 12 ? 'overview-appgrid-reenabled.png'
                : index === 13 ? 'overview-appgrid-sharp.png'
                : index === 20 ? 'overview-crop-before.png'
                : index === 21 ? 'overview-crop-after.png'
                : index === 30 ? 'overview-mid.png'
                : index === 31 ? 'overview-scroll-mid.png'
                : index === 32 ? 'overview-scroll-end.png'
                : index === 33 ? 'overview-scroll-mid2.png'
                : 'overview.png';
            const path = `${base}/${name}`;
            const file = Gio.File.new_for_path(path);

            file.replace_contents(
                bytes.get_data(),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null);

            result = JSON.stringify({ok, area, path, size: bytes.get_size()});
        } catch (e) {
            result = `error: ${e}`;
        }

        GLib.source_remove(timeoutId);
        loop.quit();
    });

    loop.run();
    return result;
})()
