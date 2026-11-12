#!/usr/bin/env bash
# Debug helper: start an isolated headless shell with a virtual monitor, open
# the overview through org.gnome.Shell.Eval, capture a PNG, print diagnostics.
#
# Requires --unsafe-mode. Intended only for the nested test session.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd -- "$HERE/.." && pwd)"
ROOT="$(cd -- "$EXT_DIR/../.." && pwd)"
TEST_HOME="$ROOT/.test-home"
DATA_HOME="$TEST_HOME/data"
CONFIG_HOME="$TEST_HOME/config"
CACHE_HOME="$TEST_HOME/cache"
LOG_FILE="$TEST_HOME/eval-nested.log"
SHOT_FILE="$TEST_HOME/overview.png"
SHOT_FILE2="$TEST_HOME/overview-noeffect.png"
SHOT_FILE3="$TEST_HOME/overview-appgrid.png"
SHOT_FILE4="$TEST_HOME/overview-disabled.png"
SHOT_FILE5="$TEST_HOME/overview-reenabled.png"

UUID="overview-clear-wallpaper@ohana986.github.io"
BMS_UUID="blur-my-shell@aunetx"
BMS_SRC="${BMS_SRC:-$HOME/.local/share/gnome-shell/extensions/$BMS_UUID}"

mkdir -p "$DATA_HOME/gnome-shell/extensions" "$CONFIG_HOME" "$CACHE_HOME"

EXT_DEST_ROOT="$DATA_HOME/gnome-shell/extensions"
EXT_DEST="$EXT_DEST_ROOT/$UUID"
BMS_DEST="$EXT_DEST_ROOT/$BMS_UUID"

rm -rf -- "$EXT_DEST"
cp -a -- "$EXT_DIR" "$EXT_DEST"

HAVE_BMS=0
if [[ -d "$BMS_SRC" ]]; then
    rm -rf -- "$BMS_DEST"
    cp -a -- "$BMS_SRC" "$BMS_DEST"
    # The shell's extension update service can replace the copied directory
    # and drop schemas/gschemas.compiled, which makes BMS fail to start.
    # Removing version/url from this throwaway copy avoids that check.
    if [[ -f "$BMS_DEST/metadata.json" ]] && command -v jq >/dev/null; then
        tmp_metadata="$BMS_DEST/metadata.json.tmp"
        jq 'del(.version, .url)' "$BMS_DEST/metadata.json" > "$tmp_metadata" \
            && mv "$tmp_metadata" "$BMS_DEST/metadata.json"
    fi
    HAVE_BMS=1
fi

for dir in "$EXT_DEST" "$BMS_DEST"; do
    if [[ -d "$dir/schemas" ]]; then
        glib-compile-schemas --strict "$dir/schemas"
    fi
done

ENABLED="['$UUID'"
if [[ "$HAVE_BMS" -eq 1 ]]; then
    ENABLED="['$UUID','$BMS_UUID'"
fi
ENABLED="$ENABLED]"

if [[ "${NO_EXT:-0}" == 1 ]]; then
    ENABLED="[]"
fi

RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
rm -f -- "$SHOT_FILE" "$SHOT_FILE2" "$SHOT_FILE3" "$SHOT_FILE4" "$SHOT_FILE5"

dbus-run-session -- bash -c '
    set -euo pipefail
    export XDG_DATA_HOME="'"$DATA_HOME"'"
    export XDG_CONFIG_HOME="'"$CONFIG_HOME"'"
    export XDG_CACHE_HOME="'"$CACHE_HOME"'"
    export XDG_RUNTIME_DIR="'"$RUNTIME_DIR"'"
    export GSETTINGS_BACKEND=keyfile
    # Let the gsettings CLI find the schema shipped by the extension;
    # GNOME Shell itself reads it through Extension.getSettings().
    export GSETTINGS_SCHEMA_DIR="'"$EXT_DEST/schemas"'"
    export TEST_HOME="'"$TEST_HOME"'"
    export SHOT_PATH="'"$SHOT_FILE"'"
    export EVAL_JS_DIR="'"$HERE"'"

    # The keyfile backend keeps values across runs; start from a known state.
    gsettings set org.gnome.shell.extensions.overview-clear \
        app-grid-native-wallpaper true

    gsettings set org.gnome.shell enabled-extensions "'"$ENABLED"'"
    gsettings set org.gnome.shell disable-user-extensions false

    # High-contrast 1920x1080 test pattern: color bars, grid and a large
    # number make 1:1 crops easy to verify, including the sliver of a
    # neighboring workspace card. Fall back to cat.jpg if ffmpeg is missing.
    TEST_WALLPAPER="$TEST_HOME/wallpaper-test.png"
    if command -v ffmpeg >/dev/null 2>&1; then
        ffmpeg -loglevel error -y -f lavfi \
            -i "testsrc=size=1920x1080:rate=1" -frames:v 1 "$TEST_WALLPAPER"
        WALLPAPER="file://$TEST_WALLPAPER"
    else
        WALLPAPER="file:///usr/share/pixmaps/faces/cat.jpg"
    fi

    gsettings set org.gnome.desktop.background picture-uri "$WALLPAPER"
    gsettings set org.gnome.desktop.background picture-uri-dark "$WALLPAPER"
    gsettings set org.gnome.desktop.background picture-options zoom

    gnome-shell --wayland --headless --virtual-monitor 1920x1080 --unsafe-mode \
        > "'"$LOG_FILE"'" 2>&1 &
    SHELL_PID=$!
    trap "kill $SHELL_PID 2>/dev/null || true" EXIT

    eval_js() {
        gdbus call --session \
            --dest org.gnome.Shell \
            --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Eval "$1"
    }

    for _ in $(seq 1 60); do
        if eval_js "1+1" 2>/dev/null | grep -q "true"; then
            break
        fi
        sleep 0.5
    done

    sleep 2
    echo "--- desktop screenshot (overview hidden) ---"
    eval_js "Main.overview.hide(); 1" || true
    sleep 1
    eval_js "globalThis.__overviewClearShotIndex = 9; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true

    echo "--- show overview ---"
    eval_js "Main.overview.show(); \"ok\"" || true
    sleep 2

    echo "--- mid-animation crop ---"
    eval_js "Main.overview.hide(); 1" || true
    sleep 1
    eval_js "globalThis.__overviewClearShotIndex = 30; Main.overview.show(); 1" || true
    sleep 0.12
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true
    sleep 2

    echo "--- screenshot ---"
    eval_js "globalThis.__overviewClearShotIndex = 1; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true

    echo "--- diagnostics ---"
    eval_js "$(cat "$EVAL_JS_DIR/diagnostics.js")" || true

    echo "--- geometry ---"
    eval_js "$(cat "$EVAL_JS_DIR/geometry.js")" || true

    echo "--- window picker: crop diagnostics (expect cropping true) ---"
    eval_js "$(cat "$EVAL_JS_DIR/geometry.js")" || true
    eval_js "$(cat "$EVAL_JS_DIR/diagnostics.js")" || true

    echo "--- scroll to next workspace (mid animation) ---"
    eval_js "Main.overview._overview._controls._workspacesDisplay._scrollAdjustment.ease(1, {duration: 600}); 1" || true
    sleep 0.12
    eval_js "globalThis.__overviewClearShotIndex = 31; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true
    sleep 0.2
    eval_js "globalThis.__overviewClearShotIndex = 33; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true
    sleep 1.5
    eval_js "globalThis.__overviewClearShotIndex = 32; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true
    eval_js "Main.overview._overview._controls._workspacesDisplay._scrollAdjustment.ease(0, {duration: 400}); 1" || true
    sleep 1.5

    echo "--- app grid native wallpaper (setting on, expect cropping false) ---"
    eval_js "Main.overview._overview._controls.dash.showAppsButton.checked = true; 1" || true
    sleep 2
    eval_js "$(cat "$EVAL_JS_DIR/diagnostics.js")" || true
    eval_js "globalThis.__overviewClearShotIndex = 10; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true

    echo "--- disabled in app grid (native reference) ---"
    eval_js "$(cat "$EVAL_JS_DIR/disable-extension.js")" || true
    sleep 2
    eval_js "$(cat "$EVAL_JS_DIR/diagnostics.js")" || true
    eval_js "globalThis.__overviewClearShotIndex = 11; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true

    echo "--- re-enabled in app grid (expect native again) ---"
    eval_js "$(cat "$EVAL_JS_DIR/enable-extension.js")" || true
    sleep 2
    eval_js "$(cat "$EVAL_JS_DIR/diagnostics.js")" || true
    eval_js "globalThis.__overviewClearShotIndex = 12; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true

    echo "--- setting off: sharp crop in app grid (expect cropping true) ---"
    gsettings set org.gnome.shell.extensions.overview-clear \
        app-grid-native-wallpaper false
    sleep 2
    eval_js "$(cat "$EVAL_JS_DIR/diagnostics.js")" || true
    eval_js "globalThis.__overviewClearShotIndex = 13; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true

    echo "--- setting on: back to native app grid ---"
    gsettings set org.gnome.shell.extensions.overview-clear \
        app-grid-native-wallpaper true
    sleep 2
    eval_js "$(cat "$EVAL_JS_DIR/diagnostics.js")" || true

    echo "--- window picker disabled/re-enabled ---"
    eval_js "Main.overview._overview._controls.dash.showAppsButton.checked = false; 1" || true
    sleep 2
    eval_js "$(cat "$EVAL_JS_DIR/diagnostics.js")" || true
    eval_js "$(cat "$EVAL_JS_DIR/disable-extension.js")" || true
    sleep 2
    eval_js "globalThis.__overviewClearShotIndex = 4; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true
    eval_js "globalThis.__overviewClearShotIndex = 5; 1" || true
    eval_js "$(cat "$EVAL_JS_DIR/enable-extension.js")" || true
    sleep 2
    eval_js "$(cat "$EVAL_JS_DIR/diagnostics.js")" || true
    eval_js "$(cat "$EVAL_JS_DIR/capture-screenshot.js")" || true

    sleep 1
    kill "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true
' 2>&1 | tee "$LOG_FILE.stdout"
