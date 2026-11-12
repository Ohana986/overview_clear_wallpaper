#!/usr/bin/env bash
# Launch an isolated nested GNOME Shell session for testing this extension.
#
# The script does not touch the running desktop session or ~/.local/share.
# Everything it creates lives under the repository's .test-home directory.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd -- "$HERE/.." && pwd)"
ROOT="$(cd -- "$EXT_DIR/../.." && pwd)"
TEST_HOME="$ROOT/.test-home"
DATA_HOME="$TEST_HOME/data"
CONFIG_HOME="$TEST_HOME/config"
CACHE_HOME="$TEST_HOME/cache"
LOG_FILE="$TEST_HOME/nested.log"

UUID="overview-clear@local"
BMS_UUID="blur-my-shell@aunetx"
BMS_SRC="${BMS_SRC:-$HOME/.local/share/gnome-shell/extensions/$BMS_UUID}"

mkdir -p "$DATA_HOME/gnome-shell/extensions" \
         "$CONFIG_HOME" "$CACHE_HOME"

EXT_DEST_ROOT="$DATA_HOME/gnome-shell/extensions"
EXT_DEST="$EXT_DEST_ROOT/$UUID"
BMS_DEST="$EXT_DEST_ROOT/$BMS_UUID"

case "$EXT_DEST" in
    "$EXT_DEST_ROOT"/*) ;;
    *) echo "unsafe destination: $EXT_DEST" >&2; exit 1;;
esac

rm -rf -- "$EXT_DEST"
cp -a -- "$EXT_DIR" "$EXT_DEST"

HAVE_BMS=0
if [[ -d "$BMS_SRC" ]]; then
    rm -rf -- "$BMS_DEST"
    cp -a -- "$BMS_SRC" "$BMS_DEST"
    HAVE_BMS=1
else
    echo "warning: Blur My Shell not found at $BMS_SRC" >&2
fi

for dir in "$EXT_DEST" "$BMS_DEST"; do
    if [[ -d "$dir/schemas" ]]; then
        glib-compile-schemas --strict "$dir/schemas"
    fi
done

if [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
    RUNTIME_DIR="$XDG_RUNTIME_DIR"
else
    RUNTIME_DIR="/run/user/$(id -u)"
fi

export XDG_DATA_HOME="$DATA_HOME"
export XDG_CONFIG_HOME="$CONFIG_HOME"
export XDG_CACHE_HOME="$CACHE_HOME"
export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export GSETTINGS_BACKEND=keyfile
export G_MESSAGES_DEBUG="${G_MESSAGES_DEBUG:-}"

ENABLED="['$UUID'"
if [[ "$HAVE_BMS" -eq 1 ]]; then
    ENABLED="['$UUID','$BMS_UUID'"
fi
ENABLED="$ENABLED]"

echo "Test home: $TEST_HOME"
echo "Log:       $LOG_FILE"
echo "BMS:       $([[ "$HAVE_BMS" -eq 1 ]] && echo enabled || echo missing)"
echo
echo "Close the nested window to exit, or press Alt+F2 and type: debugexit"
echo

dbus-run-session -- bash -c '
    set -euo pipefail
    export XDG_DATA_HOME="'"$DATA_HOME"'"
    export XDG_CONFIG_HOME="'"$CONFIG_HOME"'"
    export XDG_CACHE_HOME="'"$CACHE_HOME"'"
    export XDG_RUNTIME_DIR="'"$RUNTIME_DIR"'"
    export GSETTINGS_BACKEND=keyfile

    gsettings set org.gnome.shell enabled-extensions "'"$ENABLED"'"
    gsettings set org.gnome.shell disable-user-extensions false

    gnome-shell --wayland --devkit
' 2>&1 | tee "$LOG_FILE"
