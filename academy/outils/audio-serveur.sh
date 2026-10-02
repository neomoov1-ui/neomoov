#!/bin/sh
# Synthèse vocale des modules sur le serveur, dans le conteneur neomoov-tts (Piper + ffmpeg).
# Entrée : /w/texte/mN/NN.txt ; sortie : /w/sortie/mN/NN.wav, /w/sortie/mN.mp3 (séquences séparées par 0,9 s de
# silence) et /w/sortie/durees.json (durée de chaque séquence en secondes, pour la vidéo).
# Usage dans le conteneur : sh /w/audio-serveur.sh <voix, ex. fr_FR-siwis-medium>
set -e
VOIX="${1:-fr_FR-siwis-medium}"
MODELE="/w/voix/$VOIX.onnx"
[ -f "$MODELE" ] || python -m piper.download_voices "$VOIX" --download-dir /w/voix
mkdir -p /w/sortie
printf '{' > /w/sortie/durees.json
premier=1
for d in /w/texte/m*; do
  m=$(basename "$d")
  mkdir -p "/w/sortie/$m"
  : > "/w/sortie/$m/liste.txt"
  for t in "$d"/*.txt; do
    n=$(basename "$t" .txt)
    python -m piper --model "$MODELE" --length-scale 1.05 --sentence-silence 0.35 --output_file "/w/sortie/$m/$n.wav" < "$t" >/dev/null 2>&1
    duree=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/w/sortie/$m/$n.wav")
    [ $premier -eq 1 ] || printf ',' >> /w/sortie/durees.json
    premier=0
    printf '"%s/%s":%s' "$m" "$n" "$duree" >> /w/sortie/durees.json
    printf "file '%s.wav'\nfile '../silence.wav'\n" "$n" >> "/w/sortie/$m/liste.txt"
  done
  [ -f /w/sortie/silence.wav ] || ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=22050:cl=mono -t 0.9 /w/sortie/silence.wav
  (cd /w/sortie && ffmpeg -loglevel error -y -f concat -safe 0 -i "$m/liste.txt" -codec:a libmp3lame -b:a 96k -ar 44100 "$m.mp3")
  printf '%s : %s s\n' "$m" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/w/sortie/$m.mp3")"
done
printf '}\n' >> /w/sortie/durees.json
echo "termine"
