#!/usr/bin/env bash
# make-gif.sh <name>: videos/<name>/frames.txt -> gifs/<name>.gif (960px, 12 fps, 128-colour palette)
set -e
name=$1
mkdir -p gifs
cd "videos/$name"
ffmpeg -loglevel error -y -f concat -safe 0 -i frames.txt \
  -vf "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 "../../gifs/$name.gif"
cd ../..
ls -la "gifs/$name.gif" | awk '{print $5, $9}'
