#!/usr/bin/env bash
# Recria o ambiente do comparador (o container de nuvem é temporário). Uso: bash scripts/setup_env.sh
set -euo pipefail
VENV="${VENV:-/tmp/claude-0/ocrenv}"
python3 -m venv "$VENV"
"$VENV/bin/pip" install -q rapidocr-onnxruntime pillow numpy
"$VENV/bin/python" -c "from rapidocr_onnxruntime import RapidOCR; print('ambiente ok:', '$VENV')"
