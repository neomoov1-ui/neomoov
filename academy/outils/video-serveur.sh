#!/bin/sh
# Assemblage des vidéos narrées sur le serveur (conteneur neomoov-tts, ffmpeg) : images fixes + narration MP3.
# Entrée : /w/video/mN/NN.png + liste.txt (durées), /w/sortie/mN.mp3 ; sortie : /w/video/mN.mp4 (H.264 720p, AAC).
set -e
for d in /w/video/m*/; do
  m=$(basename "$d")
  [ -f "/w/sortie/$m.mp3" ] || { echo "$m : audio absent"; continue; }
  (cd "$d" && ffmpeg -loglevel error -y -f concat -safe 0 -i liste.txt -i "/w/sortie/$m.mp3" \
     -c:v libx264 -preset veryfast -tune stillimage -r 10 -pix_fmt yuv420p -vf "scale=1280:720" \
     -c:a aac -b:a 96k -movflags +faststart -shortest "/w/video/$m.mp4")
  printf '%s : %s s, %s octets\n' "$m" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/w/video/$m.mp4")" "$(stat -c %s "/w/video/$m.mp4")"
done
echo "termine"
