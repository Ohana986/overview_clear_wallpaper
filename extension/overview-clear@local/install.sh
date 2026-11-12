#!/usr/bin/env bash
# Install overview-clear@local into the current user's GNOME Shell extension
# directory. Run this as your normal desktop user, not with sudo.
#
# Usage:
#   ./install.sh              install or upgrade
#   ./install.sh --uninstall  disable and remove
#
# The script only writes below ${XDG_DATA_HOME:-$HOME/.local/share}.
# It never modifies Blur My Shell or any other extension.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
UUID="overview-clear@local"
SCHEMA_ID="org.gnome.shell.extensions.overview-clear"
SCHEMA_FILE="$HERE/schemas/$SCHEMA_ID.gschema.xml"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
EXT_ROOT="$DATA_HOME/gnome-shell/extensions"
DEST="$EXT_ROOT/$UUID"

if [[ "${EUID}" -eq 0 ]]; then
    echo "error: run this as your desktop user, not as root." >&2
    echo "       installing as root would write to /root, not your session." >&2
    exit 1
fi

if [[ "${1:-}" == "--uninstall" ]]; then
    if command -v gnome-extensions >/dev/null 2>&1; then
        gnome-extensions disable "$UUID" 2>/dev/null || true
    fi
    rm -rf -- "$DEST"
    echo "Removed $DEST"
    exit 0
fi

if [[ ! -f "$HERE/metadata.json" ||
      ! -f "$HERE/extension.js" ||
      ! -f "$HERE/prefs.js" ||
      ! -f "$HERE/stylesheet.css" ||
      ! -f "$SCHEMA_FILE" ||
      ! -d "$HERE/lib" ]]; then
    echo "error: run install.sh from the extension directory." >&2
    echo "       required files: metadata.json, extension.js, prefs.js," >&2
    echo "       stylesheet.css, lib/, schemas/$SCHEMA_ID.gschema.xml" >&2
    exit 1
fi

if ! grep -q "\"uuid\"[[:space:]]*:[[:space:]]*\"$UUID\"" "$HERE/metadata.json"; then
    echo "error: metadata.json does not declare uuid $UUID." >&2
    exit 1
fi

SHELL_VERSION="$(gnome-shell --version 2>/dev/null || true)"
echo "GNOME Shell: ${SHELL_VERSION:-unknown}"
if [[ "$SHELL_VERSION" =~ GNOME\ Shell\ ([0-9]+)\. ]]; then
    SHELL_MAJOR="${BASH_REMATCH[1]}"
    if [[ "$SHELL_MAJOR" != "50" ]]; then
        echo "warning: this build declares shell-version 50; current major is $SHELL_MAJOR." >&2
        echo "         GNOME Shell may refuse to load it." >&2
    fi
fi

mkdir -p -- "$EXT_ROOT"

if [[ -e "$DEST" ]]; then
    BACKUP="$EXT_ROOT/$UUID.bak.$(date +%Y%m%d-%H%M%S)"
    echo "Existing install found; moving it to:"
    echo "  $BACKUP"
    mv -- "$DEST" "$BACKUP"
fi

mkdir -p -- "$DEST/lib" "$DEST/schemas"
install -m644 -- "$HERE/metadata.json" "$DEST/metadata.json"
install -m644 -- "$HERE/extension.js" "$DEST/extension.js"
install -m644 -- "$HERE/prefs.js" "$DEST/prefs.js"
install -m644 -- "$HERE/stylesheet.css" "$DEST/stylesheet.css"
install -m644 -- "$HERE"/lib/*.js "$DEST/lib/"
install -m644 -- "$SCHEMA_FILE" "$DEST/schemas/$SCHEMA_ID.gschema.xml"
if [[ -f "$HERE/README.md" ]]; then
    install -m644 -- "$HERE/README.md" "$DEST/README.md"
fi

# The extension's settings UI and the sharp wallpaper both read this schema
# through Extension.getSettings(), which looks in the extension's own
# schemas/ directory; it must be compiled in place.
if command -v glib-compile-schemas >/dev/null 2>&1; then
    glib-compile-schemas --strict "$DEST/schemas"
else
    echo "warning: glib-compile-schemas is missing; the settings page will" >&2
    echo "         not be available until it is installed and re-run." >&2
fi

echo "Installed files:"
find "$DEST" -maxdepth 2 -type f -printf '  %p\n' | sort

if [[ -d "$EXT_ROOT/blur-my-shell@aunetx" ]]; then
    echo "Blur My Shell: found (its overview background will be used)."
else
    echo "Blur My Shell: not found (outside cards will use the #222226 fallback)."
fi

if ! command -v gnome-extensions >/dev/null 2>&1; then
    echo
    echo "gnome-extensions is not available. Log out and back in, then run:"
    echo "  gnome-extensions enable $UUID"
    exit 0
fi

# Ask the shell to rescan the extension directory, then enable. On Wayland the
# shell cannot be restarted in place; if this fails, log out and back in.
gnome-extensions list >/dev/null 2>&1 || true
sleep 1

if gnome-extensions enable "$UUID" 2>/dev/null; then
    echo "Enable request sent."
else
    echo "warning: could not enable automatically." >&2
fi

sleep 1

echo
echo "Extension state:"
gnome-extensions info "$UUID" 2>&1 || true

cat <<EOF

Install path:
  $DEST

If the state is not ENABLED, log out and back in (Wayland cannot restart
GNOME Shell in place), then enable it:
  gnome-extensions enable $UUID

Uninstall:
  $HERE/install.sh --uninstall
  # or manually:
  gnome-extensions disable $UUID
  rm -rf "$DEST"
EOF
