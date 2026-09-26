#!/usr/bin/env bash
# Rebuild scripts/macos/AppIcon.icns and scripts/windows/PhoneWandTray/AppIcon.ico from icon.svg. Needs macOS (qlmanage, iconutil) and Python
# with Pillow. The .icns is committed, so this only needs running when the icon changes.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
qlmanage -t -s 1024 -o "$tmp" "$here/icon.svg" >/dev/null 2>&1
python3 - "$tmp/icon.svg.png" "$tmp/icon.png" "$here/../windows/PhoneWandTray/AppIcon.ico" <<'PY'
import sys
from PIL import Image, ImageDraw
img = Image.open(sys.argv[1]).convert("RGBA")
# Quick Look renders on white: keep only the rounded square (x 100 to 924, radius 185).
mask = Image.new("L", img.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((100, 100, 923, 923), radius=185, fill=255)
img.putalpha(mask)
img.save(sys.argv[2])
# The Windows tray app's icon, from the same artwork.
img.save(sys.argv[3], sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
PY
set_dir="$tmp/AppIcon.iconset"
mkdir "$set_dir"
for size in 16 32 128 256 512; do
  sips -z $size $size "$tmp/icon.png" --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$tmp/icon.png" --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$set_dir" -o "$here/AppIcon.icns"
echo "wrote $here/AppIcon.icns"
