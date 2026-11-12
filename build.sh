#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Build the zip submitted to extensions.gnome.org.
#
# Run from anywhere:
#   ./build.sh
#
# The output is written to dist/. The script stages only runtime files, so
# install.sh, test/ and README.md are never included in the upload package.

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$ROOT/extension/overview-clear-wallpaper@ohana986.github.io"
BUILD_ROOT="$ROOT/.build"
DIST_DIR="$ROOT/dist"
SCHEMA_ID="org.gnome.shell.extensions.overview-clear"
SCHEMA_REL="schemas/$SCHEMA_ID.gschema.xml"

for command in gnome-extensions glib-compile-schemas zipinfo; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo "error: $command is required to build the upload package." >&2
        exit 1
    fi
done

for file in metadata.json extension.js prefs.js stylesheet.css "$SCHEMA_REL"; do
    if [[ ! -f "$EXT_DIR/$file" ]]; then
        echo "error: missing $EXT_DIR/$file" >&2
        exit 1
    fi
done
if [[ ! -d "$EXT_DIR/lib" ]]; then
    echo "error: missing $EXT_DIR/lib" >&2
    exit 1
fi

UUID="$(sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$EXT_DIR/metadata.json" | head -n 1)"
if [[ -z "$UUID" ]]; then
    echo "error: could not read uuid from metadata.json" >&2
    exit 1
fi

rm -rf -- "$BUILD_ROOT"
mkdir -p -- "$BUILD_ROOT/$UUID" "$DIST_DIR"

cp -- "$EXT_DIR/metadata.json" \
      "$EXT_DIR/extension.js" \
      "$EXT_DIR/prefs.js" \
      "$EXT_DIR/stylesheet.css" \
      "$BUILD_ROOT/$UUID/"
cp -a -- "$EXT_DIR/lib" "$EXT_DIR/schemas" "$BUILD_ROOT/$UUID/"

# Validate the schema before packaging. gnome-extensions pack includes the XML;
# the extension installer compiles it after installation.
glib-compile-schemas --strict "$BUILD_ROOT/$UUID/schemas"
rm -f -- "$BUILD_ROOT/$UUID/schemas/gschemas.compiled"

gnome-extensions pack "$BUILD_ROOT/$UUID" \
    --force \
    --extra-source=lib \
    --schema="$SCHEMA_REL" \
    --out-dir "$DIST_DIR"

ZIP="$DIST_DIR/$UUID.shell-extension.zip"
if [[ ! -f "$ZIP" ]]; then
    echo "error: expected package was not created: $ZIP" >&2
    exit 1
fi

contents="$(zipinfo -1 "$ZIP")"
for required in metadata.json extension.js prefs.js lib/manager.js; do
    if ! grep -qxF -- "$required" <<<"$contents"; then
        echo "error: $required is missing from $ZIP" >&2
        exit 1
    fi
done
if ! grep -q '^schemas/.*\.gschema\.xml$' <<<"$contents"; then
    echo "error: the GSettings schema is missing from $ZIP" >&2
    exit 1
fi
if grep -qE '^(test/|install\.sh$)' <<<"$contents"; then
    echo "error: development files leaked into $ZIP" >&2
    exit 1
fi

rm -rf -- "$BUILD_ROOT"
echo "Built: $ZIP"
