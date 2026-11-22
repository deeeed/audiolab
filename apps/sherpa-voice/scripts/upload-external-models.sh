#!/usr/bin/env bash
# upload-external-models.sh
#
# Downloads sherpa-onnx model files for all 10 web features,
# extracts the individual model files, and uploads them to a
# HuggingFace repository (or documents manual upload).
#
# Prerequisites:
#   pip install huggingface_hub
#   huggingface-cli login
#
# Usage:
#   ./scripts/upload-external-models.sh [--repo REPO_ID] [--dry-run]
#
# Required CDN file structure after upload:
#   asr/encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt
#   language-id/tiny-encoder.onnx, tiny-decoder.onnx
#   vad/silero_vad_v5.onnx
#   tts/model.onnx, tokens.txt, lexicon-en-us.txt
#   kws/encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt, keywords.txt
#   speakers/segmentation.onnx, embedding.onnx
#   enhancement/gtcrn.onnx
#   audio-tagging/model.onnx, labels.txt
#   speaker-id/model.onnx
#   punctuation/model.onnx, bpe.vocab

set -euo pipefail

REPO_ID="${REPO_ID:-}"
DRY_RUN=false
WORK_DIR=$(mktemp -d)

# Source URLs
ASR_ARCHIVE="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17.tar.bz2"
LANGID_ARCHIVE="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2"
VAD_MODEL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx"
TTS_ARCHIVE="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-icefall-en_US-ljspeech-low.tar.bz2"
TTS_LEXICON="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/lexicon-en-us.txt"
KWS_ARCHIVE="https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2"
SPEAKER_SEG_ARCHIVE="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
SPEAKER_EMB_MODEL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"
ENHANCEMENT_MODEL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/gtcrn_simple.onnx"
# Audio tagging, speaker-id, punctuation: copy from local public/wasm/ (already downloaded by download-web-models.sh)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_ID="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_WASM="$SCRIPT_DIR/../public/wasm"

echo "Working directory: $WORK_DIR"
mkdir -p "$WORK_DIR"/{asr,language-id,vad,tts,kws,speakers,enhancement,audio-tagging,speaker-id,punctuation}

# --- ASR ---
echo ""
echo "=== Downloading ASR model archive ==="
curl -L --progress-bar "$ASR_ARCHIVE" -o "$WORK_DIR/asr-archive.tar.bz2"
echo "Extracting ASR model files..."
mkdir -p "$WORK_DIR/asr-extract"
tar -xjf "$WORK_DIR/asr-archive.tar.bz2" -C "$WORK_DIR/asr-extract"
find "$WORK_DIR/asr-extract" -name "*encoder*.onnx" -exec cp {} "$WORK_DIR/asr/encoder.onnx" \;
find "$WORK_DIR/asr-extract" -name "*decoder*.onnx" ! -name "*encoder*" -exec cp {} "$WORK_DIR/asr/decoder.onnx" \;
find "$WORK_DIR/asr-extract" -name "*joiner*.onnx" -exec cp {} "$WORK_DIR/asr/joiner.onnx" \;
find "$WORK_DIR/asr-extract" -name "tokens.txt" -exec cp {} "$WORK_DIR/asr/tokens.txt" \;
echo "ASR files:" && ls -lh "$WORK_DIR/asr/"

# --- Language ID ---
echo ""
echo "=== Downloading Language ID model archive ==="
curl -L --progress-bar "$LANGID_ARCHIVE" -o "$WORK_DIR/langid-archive.tar.bz2"
mkdir -p "$WORK_DIR/langid-extract"
tar -xjf "$WORK_DIR/langid-archive.tar.bz2" -C "$WORK_DIR/langid-extract"
find "$WORK_DIR/langid-extract" -name "tiny-encoder.onnx" -exec cp {} "$WORK_DIR/language-id/tiny-encoder.onnx" \;
find "$WORK_DIR/langid-extract" -name "tiny-decoder.onnx" -exec cp {} "$WORK_DIR/language-id/tiny-decoder.onnx" \;
echo "Language ID files:" && ls -lh "$WORK_DIR/language-id/"

# --- VAD ---
echo ""
echo "=== Downloading VAD model ==="
curl -L --progress-bar "$VAD_MODEL" -o "$WORK_DIR/vad/silero_vad_v5.onnx"
echo "VAD files:" && ls -lh "$WORK_DIR/vad/"

# --- TTS ---
echo ""
echo "=== Downloading TTS model archive ==="
curl -L --progress-bar "$TTS_ARCHIVE" -o "$WORK_DIR/tts-archive.tar.bz2"
mkdir -p "$WORK_DIR/tts-extract"
tar -xjf "$WORK_DIR/tts-archive.tar.bz2" -C "$WORK_DIR/tts-extract"
find "$WORK_DIR/tts-extract" -name "model.onnx" -exec cp {} "$WORK_DIR/tts/model.onnx" \;
find "$WORK_DIR/tts-extract" -name "tokens.txt" -exec cp {} "$WORK_DIR/tts/tokens.txt" \;
# sherpa-onnx v2.0 removed espeak-ng; the web TTS loader fetches this lexicon instead.
curl -L --progress-bar "$TTS_LEXICON" -o "$WORK_DIR/tts/lexicon-en-us.txt"
echo "TTS files:" && ls -lh "$WORK_DIR/tts/"

# --- KWS ---
echo ""
echo "=== Downloading KWS model archive ==="
curl -L --progress-bar "$KWS_ARCHIVE" -o "$WORK_DIR/kws-archive.tar.bz2"
mkdir -p "$WORK_DIR/kws-extract"
tar -xjf "$WORK_DIR/kws-archive.tar.bz2" -C "$WORK_DIR/kws-extract"
find "$WORK_DIR/kws-extract" -name "*encoder*.onnx" -exec cp {} "$WORK_DIR/kws/encoder.onnx" \;
find "$WORK_DIR/kws-extract" -name "*decoder*.onnx" ! -name "*encoder*" -exec cp {} "$WORK_DIR/kws/decoder.onnx" \;
find "$WORK_DIR/kws-extract" -name "*joiner*.onnx" -exec cp {} "$WORK_DIR/kws/joiner.onnx" \;
find "$WORK_DIR/kws-extract" -name "tokens.txt" -exec cp {} "$WORK_DIR/kws/tokens.txt" \;
find "$WORK_DIR/kws-extract" -name "keywords.txt" -exec cp {} "$WORK_DIR/kws/keywords.txt" \;
echo "KWS files:" && ls -lh "$WORK_DIR/kws/"

# --- Speaker Diarization ---
echo ""
echo "=== Downloading Speaker Diarization models ==="
curl -L --progress-bar "$SPEAKER_SEG_ARCHIVE" -o "$WORK_DIR/speaker-seg-archive.tar.bz2"
mkdir -p "$WORK_DIR/speaker-seg-extract"
tar -xjf "$WORK_DIR/speaker-seg-archive.tar.bz2" -C "$WORK_DIR/speaker-seg-extract"
find "$WORK_DIR/speaker-seg-extract" -name "model.onnx" -exec cp {} "$WORK_DIR/speakers/segmentation.onnx" \;
curl -L --progress-bar "$SPEAKER_EMB_MODEL" -o "$WORK_DIR/speakers/embedding.onnx"
echo "Speaker Diarization files:" && ls -lh "$WORK_DIR/speakers/"

# --- Enhancement ---
echo ""
echo "=== Downloading Enhancement model ==="
curl -L --progress-bar "$ENHANCEMENT_MODEL" -o "$WORK_DIR/enhancement/gtcrn.onnx"
echo "Enhancement files:" && ls -lh "$WORK_DIR/enhancement/"

# --- Audio Tagging (copy from local) ---
echo ""
echo "=== Copying Audio Tagging model from local ==="
if [ -d "$PUBLIC_WASM/audio-tagging" ]; then
  cp "$PUBLIC_WASM/audio-tagging/"* "$WORK_DIR/audio-tagging/"
  echo "Audio Tagging files:" && ls -lh "$WORK_DIR/audio-tagging/"
else
  echo "WARNING: $PUBLIC_WASM/audio-tagging not found — run download-web-models.sh first"
fi

# --- Speaker ID (copy from local) ---
echo ""
echo "=== Copying Speaker ID model from local ==="
if [ -d "$PUBLIC_WASM/speaker-id" ]; then
  cp "$PUBLIC_WASM/speaker-id/"* "$WORK_DIR/speaker-id/"
  echo "Speaker ID files:" && ls -lh "$WORK_DIR/speaker-id/"
else
  echo "WARNING: $PUBLIC_WASM/speaker-id not found — run download-web-models.sh first"
fi

# --- Punctuation (copy from local) ---
echo ""
echo "=== Copying Punctuation model from local ==="
if [ -d "$PUBLIC_WASM/punctuation" ]; then
  cp "$PUBLIC_WASM/punctuation/"* "$WORK_DIR/punctuation/"
  echo "Punctuation files:" && ls -lh "$WORK_DIR/punctuation/"
else
  echo "WARNING: $PUBLIC_WASM/punctuation not found — run download-web-models.sh first"
fi

# --- Upload ---
ALL_DIRS="asr language-id vad tts kws speakers enhancement audio-tagging speaker-id punctuation"

echo ""
if [ "$DRY_RUN" = true ]; then
  echo "=== DRY RUN — files extracted but not uploaded ==="
  echo "Files ready at: $WORK_DIR"
  echo ""
  echo "To upload manually to HuggingFace:"
  for d in $ALL_DIRS; do
    echo "  huggingface-cli upload $REPO_ID $WORK_DIR/$d $d"
  done
  echo ""
  echo "Or set modelBaseUrl in webFeatures.ts to point at your CDN."
  trap - EXIT
elif [ -n "$REPO_ID" ]; then
  echo "=== Uploading to HuggingFace: $REPO_ID ==="
  for d in $ALL_DIRS; do
    echo "Uploading $d..."
    huggingface-cli upload "$REPO_ID" "$WORK_DIR/$d" "$d"
  done
  echo ""
  echo "Done! All modelBaseUrl values in webFeatures.ts should point to:"
  echo "  https://huggingface.co/$REPO_ID/resolve/main/{feature}"
else
  echo "=== No --repo specified ==="
  echo "Files extracted to: $WORK_DIR"
  echo ""
  echo "Upload them to any CORS-enabled CDN, then set modelBaseUrl"
  echo "in apps/sherpa-voice/src/config/webFeatures.ts"
  trap - EXIT
fi
