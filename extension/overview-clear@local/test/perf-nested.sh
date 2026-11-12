#!/usr/bin/env bash
# Rough performance comparison in the headless nested session.
#
# The headless compositor renders with software GL, so absolute numbers are
# not representative of a real GPU. The comparison between the extension
# enabled and disabled is still useful: it shows the relative cost of the
# extra full-screen effect and shadow actors.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd -- "$HERE/.." && pwd)"
ROOT="$(cd -- "$EXT_DIR/../.." && pwd)"
TEST_HOME="$ROOT/.test-home-perf"
DATA_HOME="$TEST_HOME/data"
CONFIG_HOME="$TEST_HOME/config"
CACHE_HOME="$TEST_HOME/cache"
LOG_FILE="$TEST_HOME/perf.log"

UUID="overview-clear@local"
BMS_UUID="blur-my-shell@aunetx"
BMS_SRC="${BMS_SRC:-$HOME/.local/share/gnome-shell/extensions/$BMS_UUID}"

mkdir -p "$DATA_HOME/gnome-shell/extensions" "$CONFIG_HOME" "$CACHE_HOME"
EXT_DEST="$DATA_HOME/gnome-shell/extensions/$UUID"
BMS_DEST="$DATA_HOME/gnome-shell/extensions/$BMS_UUID"

rm -rf -- "$EXT_DEST" "$BMS_DEST"
cp -a -- "$EXT_DIR" "$EXT_DEST"
if [[ -d "$BMS_SRC" ]]; then
    cp -a -- "$BMS_SRC" "$BMS_DEST"
    if [[ -f "$BMS_DEST/metadata.json" ]] && command -v jq >/dev/null; then
        tmp_metadata="$BMS_DEST/metadata.json.tmp"
        jq 'del(.version, .url)' "$BMS_DEST/metadata.json" > "$tmp_metadata" \
            && mv "$tmp_metadata" "$BMS_DEST/metadata.json"
    fi
fi

for dir in "$EXT_DEST" "$BMS_DEST"; do
    if [[ -d "$dir/schemas" ]]; then
        glib-compile-schemas --strict "$dir/schemas"
    fi
done

ENABLED="['$UUID','$BMS_UUID']"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

dbus-run-session -- bash -c '
    set -euo pipefail
    export XDG_DATA_HOME="'"$DATA_HOME"'"
    export XDG_CONFIG_HOME="'"$CONFIG_HOME"'"
    export XDG_CACHE_HOME="'"$CACHE_HOME"'"
    export XDG_RUNTIME_DIR="'"$RUNTIME_DIR"'"
    export GSETTINGS_BACKEND=keyfile
    export GSETTINGS_SCHEMA_DIR="'"$EXT_DEST/schemas"'"
    export TEST_HOME="'"$TEST_HOME"'"
    export EVAL_JS_DIR="'"$HERE"'"

    gsettings set org.gnome.shell enabled-extensions "'"$ENABLED"'"
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell.extensions.overview-clear \
        app-grid-native-wallpaper true

    TEST_WALLPAPER="$TEST_HOME/wallpaper-test.png"
    ffmpeg -loglevel error -y -f lavfi \
        -i "testsrc=size=1920x1080:rate=1" -frames:v 1 "$TEST_WALLPAPER"
    gsettings set org.gnome.desktop.background picture-uri "file://$TEST_WALLPAPER"
    gsettings set org.gnome.desktop.background picture-uri-dark "file://$TEST_WALLPAPER"
    gsettings set org.gnome.desktop.background picture-options zoom

    gnome-shell --wayland --headless --virtual-monitor 1920x1080 --unsafe-mode \
        > "'"$LOG_FILE"'" 2>&1 &
    SHELL_PID=$!
    trap "kill $SHELL_PID 2>/dev/null || true" EXIT

    eval_js() {
        gdbus call --session \
            --dest org.gnome.Shell \
            --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Eval "$1" >/dev/null
    }

    for _ in $(seq 1 60); do
        if gdbus call --session --dest org.gnome.Shell \
            --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Eval "1+1" 2>/dev/null | grep -q true; then
            break
        fi
        sleep 0.5
    done
    sleep 2

    cpu_ticks() {
        awk "{print \$14+\$15}" "/proc/$SHELL_PID/stat"
    }

    # Static measurement: overview open, no input for two seconds.
    static_run() {
        eval_js "Main.overview.show(); 1"
        sleep 1
        local before after
        before=$(cpu_ticks)
        sleep 2
        after=$(cpu_ticks)
        eval_js "Main.overview.hide(); 1"
        sleep 0.5
        echo $((after - before))
    }

    # Animation measurement: open, app grid, close, repeated.
    animation_run() {
        local before after
        before=$(cpu_ticks)
        for _ in $(seq 1 8); do
            eval_js "Main.overview.show(); 1"
            sleep 0.45
            eval_js "Main.overview._overview._controls.dash.showAppsButton.checked = true; 1"
            sleep 0.45
            eval_js "Main.overview.hide(); 1"
            sleep 0.45
        done
        after=$(cpu_ticks)
        # Leave the overview in a clean state.
        sleep 0.5
        echo $((after - before))
    }

    # Warm up once so the first run does not include module loading.
    eval_js "Main.overview.show(); 1"
    sleep 1
    eval_js "Main.overview._overview._controls.dash.showAppsButton.checked = true; 1"
    sleep 1
    eval_js "Main.overview.hide(); 1"
    sleep 1

    echo "=== extension enabled ==="
    echo "static_ticks=$(static_run)"
    echo "animation_ticks=$(animation_run)"

    eval_js "$(cat "$EVAL_JS_DIR/disable-extension.js")"
    sleep 2

    echo "=== extension disabled ==="
    echo "static_ticks=$(static_run)"
    echo "animation_ticks=$(animation_run)"

    echo "ticks_per_second=$(getconf CLK_TCK)"
' 2>&1 | tee "$TEST_HOME/perf.stdout" | grep -E "^===|ticks"
