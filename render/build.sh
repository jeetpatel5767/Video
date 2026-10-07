#!/usr/bin/env bash
# Full pipeline: soundtrack -> frames -> MP4 -> contact sheet.
#   PYTHON=python3 bash render/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PYTHON:-python3}
mkdir -p build out
[ -d assets/fonts/cabinet-grotesk ] || ./assets/fonts/get-cabinet-grotesk.sh

echo "1/4 soundtrack"
"$PY" audio/soundtrack.py build

echo "2/4 frames (Playwright)"
node render/render.mjs --out build/video.mkv --workers "${WORKERS:-4}" --blur --shutter 0.5

echo "3/4 encode MP4"
ffmpeg -v error -y -i build/video.mkv -i build/soundtrack.wav \
  -map 0:v -map 1:a \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset slow -crf 12 -profile:v high -tune animation \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 320k -ar 48000 \
  -movflags +faststart -shortest out/jeet-patel-portfolio.mp4

echo "4/4 contact sheet"
ffmpeg -v error -y -i out/jeet-patel-portfolio.mp4 \
  -vf "select='not(mod(n\,30))',scale=320:-1,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=0x1d1d1dcc:boxborderw=4,tile=8x12:padding=4:color=white" \
  -fps_mode passthrough -frames:v 1 out/contact-sheet.jpg
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of compact out/jeet-patel-portfolio.mp4
