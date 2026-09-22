#!/usr/bin/env bash
#
# Render the advert and encode it for Twitter.
#
#   media/build.sh [path/to/music.mp3]
#
# Two steps that are easy to get wrong by hand, which is why they are here
# rather than in the shell history.
#
# THE ENCODE. Twitter re-encodes whatever it is given, and the settings below
# are the ones it does least damage to: H.264 High, yuv420p (not yuv444, which
# some clients refuse outright), and +faststart so the timeline can begin
# playing before the whole file has arrived.
#
# THE MUSIC. The video is built to read with the volume off, because Twitter
# autoplays muted and most people will never unmute it. The music is for the
# ones who do, so it is mixed to sit under the picture rather than lead it:
# normalized to -16 LUFS, which is close to what Twitter normalizes to anyway,
# so it will not be turned down and squashed on the way in.

set -euo pipefail
cd "$(dirname "$0")/.."

MUSIC="${1:-}"
OUT=media/citicious-ad.mp4
RAW=media/.render/videos/ad/1080p30/Advert.mp4

echo "--> rendering"
manim -qh --format=mp4 --media_dir media/.render media/ad.py Advert >/dev/null

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$RAW")
FADE=3.5
FADE_AT=$(python3 -c "print(max(0, $DUR - $FADE))")

if [ -n "$MUSIC" ]; then
  echo "--> encoding with music (${DUR}s, fade out over ${FADE}s)"
  # loudnorm BEFORE the fades, or normalizing would partly undo the fade it is
  # supposed to leave alone. aresample puts it back to 44.1 kHz, which loudnorm
  # leaves at its own internal rate.
  ffmpeg -loglevel error -y -i "$RAW" -i "$MUSIC" \
    -filter_complex "[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,\
afade=t=in:st=0:d=0.4,afade=t=out:st=${FADE_AT}:d=${FADE}[a]" \
    -map 0:v:0 -map "[a]" -shortest \
    -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -preset slow \
    -movflags +faststart -c:a aac -b:a 128k "$OUT"
else
  echo "--> encoding silent (${DUR}s)"
  # A silent AAC track rather than no audio track at all. Twitter accepts a
  # video with no audio, but every client handles the standard shape.
  ffmpeg -loglevel error -y -i "$RAW" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -shortest \
    -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -preset slow \
    -movflags +faststart -c:a aac -b:a 128k "$OUT"
fi

ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height \
        -of default=nw=1 "$OUT"
echo "==> $OUT"
