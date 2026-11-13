#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Capture extensions.gnome.org screenshots from a real wallpaper.
#
# Usage:
#   ./capture-store-screenshots.sh /path/to/wallpaper.jpg
#
# The script runs the headless nested session from eval-nested.sh, then
# converts the selected frames into JPEG files under screenshots/ at the
# repository root. The PNG masters remain in .test-home/ and are not
# committed.

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "usage: $0 /path/to/wallpaper.jpg" >&2
    exit 1
fi

WALLPAPER_SRC="$1"
if [[ ! -f "$WALLPAPER_SRC" ]]; then
    echo "error: wallpaper not found: $WALLPAPER_SRC" >&2
    exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "error: ffmpeg is required to convert the screenshots." >&2
    exit 1
fi

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../../.." && pwd)"
SHOTS="$ROOT/screenshots"
TEST_HOME="$ROOT/.test-home"

export WALLPAPER_SRC
"$HERE/eval-nested.sh"

mkdir -p -- "$SHOTS"

convert_shot() {
    local source="$1"
    local target="$2"

    if [[ ! -f "$source" ]]; then
        echo "error: missing screenshot: $source" >&2
        exit 1
    fi

    ffmpeg -hide_banner -loglevel error -y \
        -i "$source" -frames:v 1 -q:v 2 "$target"
}

convert_shot "$TEST_HOME/desktop.png" \
    "$SHOTS/00-desktop-reference.jpg"
convert_shot "$TEST_HOME/overview.png" \
    "$SHOTS/01-window-picker.jpg"
convert_shot "$TEST_HOME/overview-mid.png" \
    "$SHOTS/02-overview-opening.jpg"
convert_shot "$TEST_HOME/overview-scroll-mid2.png" \
    "$SHOTS/03-workspace-scroll.jpg"
convert_shot "$TEST_HOME/overview-appgrid-native.png" \
    "$SHOTS/04-app-grid-native.jpg"
convert_shot "$TEST_HOME/overview-appgrid-sharp.png" \
    "$SHOTS/05-app-grid-sharp.jpg"
convert_shot "$TEST_HOME/overview-closing-mid.png" \
    "$SHOTS/06-overview-closing.jpg"
convert_shot "$TEST_HOME/overview-appgrid-mid.png" \
    "$SHOTS/07-app-grid-transition.jpg"

echo
echo "Screenshots written to: $SHOTS"
find "$SHOTS" -maxdepth 1 -name '*.jpg' -printf '  %f\n' | sort
