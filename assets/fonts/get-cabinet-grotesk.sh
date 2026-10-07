#!/usr/bin/env bash
# Cabinet Grotesk (headings on the portfolio) is free for video use, but its
# ITF Free Font License forbids hosting the font files in a public repo.
# This downloads the official package from Fontshare into ./cabinet-grotesk/ (git-ignored).
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
curl -fsSL -o "$tmp/cabinet.zip" "https://api.fontshare.com/v2/fonts/download/cabinet-grotesk"
unzip -q -o "$tmp/cabinet.zip" -d "$tmp"
mkdir -p cabinet-grotesk
cp "$tmp"/CabinetGrotesk_Complete/Fonts/OTF/*.otf "$tmp"/CabinetGrotesk_Complete/Fonts/WEB/fonts/*.woff2 cabinet-grotesk/
cp "$tmp"/CabinetGrotesk_Complete/License/FFL.txt cabinet-grotesk/LICENSE-FFL.txt
rm -rf "$tmp"
echo "Cabinet Grotesk saved to $(pwd)/cabinet-grotesk"
