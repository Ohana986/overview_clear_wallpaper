#!/usr/bin/env bash
# Interactive nested GNOME Shell for the minimal _bin.opacity demo.
#
# Isolation:
#   - XDG_DATA_HOME / XDG_CONFIG_HOME / XDG_CACHE_HOME point inside
#     .test-home-bin-opacity in this repository.
#   - GSETTINGS_BACKEND=keyfile, so the running desktop's extension list
#     and settings are not touched.
#   - A private D-Bus session is created with dbus-run-session.
#
# The nested Shell window opens inside the current graphical session.
# Close that window, or press Alt+F2 and type `debugexit`, to exit.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd -- "$HERE/.." && pwd)"
ROOT="$(cd -- "$EXT_DIR/../.." && pwd)"

TEST_HOME="$ROOT/.test-home-bin-opacity"
DATA_HOME="$TEST_HOME/data"
CONFIG_HOME="$TEST_HOME/config"
CACHE_HOME="$TEST_HOME/cache"
LOG_FILE="$TEST_HOME/nested.log"

UUID="bin-opacity-demo@local"
BMS_UUID="blur-my-shell@aunetx"
BMS_SRC="${BMS_SRC:-$HOME/.local/share/gnome-shell/extensions/$BMS_UUID}"

if [[ ! -x /usr/libexec/mutter-devkit ]]; then
    echo "error: /usr/libexec/mutter-devkit is missing." >&2
    echo "Install the mutter-devkit package first." >&2
    exit 1
fi

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
    echo "         the demo will show #222226 through the cards instead." >&2
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

ENABLED="['$UUID'"
if [[ "$HAVE_BMS" -eq 1 ]]; then
    ENABLED="['$UUID','$BMS_UUID'"
fi
ENABLED="$ENABLED]"

SHELL_VERSION="$(gnome-shell --version | awk '{print $3}')"

echo "Test home: $TEST_HOME"
echo "Log:       $LOG_FILE"
echo "BMS:       $([[ "$HAVE_BMS" -eq 1 ]] && echo enabled || echo missing)"
echo
echo "A nested GNOME Shell window will open."
echo "  1. Click the nested window, then press Super."
echo "  2. Expect: the card wallpaper is gone; BMS wallpaper shows through;"
echo "     only the card shadow remains."
echo "  3. Alt+F2 -> lg to inspect:"
echo "       globalThis.__binOpacityDemo.hiddenCount()"
echo "  4. Close the nested window, or Alt+F2 -> debugexit, to exit."
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
    gsettings set org.gnome.shell welcome-dialog-last-shown-version "'"$SHELL_VERSION"'"

    WALLPAPER="file:///usr/share/pixmaps/faces/cat.jpg"
    if [[ -f /usr/share/pixmaps/faces/cat.jpg ]]; then
        gsettings set org.gnome.desktop.background picture-uri "$WALLPAPER"
        gsettings set org.gnome.desktop.background picture-uri-dark "$WALLPAPER"
        gsettings set org.gnome.desktop.background picture-options zoom
    fi

    gnome-shell --wayland --devkit
' 2>&1 | tee "$LOG_FILE"
