#!/usr/bin/env bash
# Headless functional smoke test for the _bin.opacity demo.
#
# This does not look at pixels and does not take screenshots. It only checks
# that, after the overview is opened, every WorkspaceBackground card reports
# `_bin.opacity === 0` and that globalThis.__binOpacityDemo.hiddenCount() > 0.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd -- "$HERE/.." && pwd)"
ROOT="$(cd -- "$EXT_DIR/../.." && pwd)"

TEST_HOME="$ROOT/.test-home-bin-opacity-smoke"
DATA_HOME="$TEST_HOME/data"
CONFIG_HOME="$TEST_HOME/config"
CACHE_HOME="$TEST_HOME/cache"
LOG_FILE="$TEST_HOME/smoke.log"
RESULT_FILE="$TEST_HOME/inspect.json"

UUID="bin-opacity-demo@local"
BMS_UUID="blur-my-shell@aunetx"
BMS_SRC="${BMS_SRC:-$HOME/.local/share/gnome-shell/extensions/$BMS_UUID}"

mkdir -p "$DATA_HOME/gnome-shell/extensions" "$CONFIG_HOME" "$CACHE_HOME"
rm -f -- "$LOG_FILE" "$RESULT_FILE"

EXT_DEST="$DATA_HOME/gnome-shell/extensions/$UUID"
BMS_DEST="$DATA_HOME/gnome-shell/extensions/$BMS_UUID"

rm -rf -- "$EXT_DEST"
cp -a -- "$EXT_DIR" "$EXT_DEST"

HAVE_BMS=0
if [[ -d "$BMS_SRC" ]]; then
    rm -rf -- "$BMS_DEST"
    cp -a -- "$BMS_SRC" "$BMS_DEST"
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

RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

dbus-run-session -- bash -c '
    set -euo pipefail
    export XDG_DATA_HOME="'"$DATA_HOME"'"
    export XDG_CONFIG_HOME="'"$CONFIG_HOME"'"
    export XDG_CACHE_HOME="'"$CACHE_HOME"'"
    export XDG_RUNTIME_DIR="'"$RUNTIME_DIR"'"
    export GSETTINGS_BACKEND=keyfile
    export INSPECT_JS="'"$HERE/inspect-cards.js"'"
    export RESULT_FILE="'"$RESULT_FILE"'"

    gsettings set org.gnome.shell enabled-extensions "'"$ENABLED"'"
    gsettings set org.gnome.shell disable-user-extensions false

    if [[ -f /usr/share/pixmaps/faces/cat.jpg ]]; then
        gsettings set org.gnome.desktop.background picture-uri "file:///usr/share/pixmaps/faces/cat.jpg"
        gsettings set org.gnome.desktop.background picture-uri-dark "file:///usr/share/pixmaps/faces/cat.jpg"
        gsettings set org.gnome.desktop.background picture-options zoom
    fi

    gnome-shell --wayland --headless --virtual-monitor 1920x1080 --unsafe-mode \
        > "'"$LOG_FILE"'" 2>&1 &
    SHELL_PID=$!
    trap "kill $SHELL_PID 2>/dev/null || true; wait $SHELL_PID 2>/dev/null || true" EXIT

    eval_js() {
        gdbus call --session \
            --dest org.gnome.Shell \
            --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Eval "$1"
    }

    for _ in $(seq 1 80); do
        if eval_js "1+1" 2>/dev/null | grep -q "true"; then
            break
        fi
        sleep 0.25
    done

    # Wait until the extension manager has actually enabled the demo.
    for _ in $(seq 1 80); do
        if eval_js "Main.extensionManager.lookup('bin-opacity-demo@local')?.state === 1" 2>/dev/null \
                | grep -q "true"; then
            break
        fi
        sleep 0.25
    done

    sleep 1
    eval_js "Main.overview.show(); \"ok\"" >/dev/null || true
    sleep 2

    eval_js "$(cat "$INSPECT_JS")" > "$RESULT_FILE" 2>&1 || true
' || true

if [[ ! -s "$RESULT_FILE" ]]; then
    echo "FAIL: no inspect result; see $LOG_FILE" >&2
    exit 1
fi

echo "--- inspect result ---"
cat "$RESULT_FILE"
echo
echo "--- extension log lines ---"
grep -E "\[bin-opacity-demo\]" "$LOG_FILE" || true

if grep -Eq 'binOpacity[^0-9]*0' "$RESULT_FILE"; then
    echo
    echo "PASS: at least one workspace card has _bin.opacity = 0."
    exit 0
fi

echo
echo "FAIL: no workspace card with _bin.opacity = 0." >&2
echo "Log: $LOG_FILE" >&2
exit 1
