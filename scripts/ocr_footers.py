"""Lê o rodapé (número, set, idioma) da referência e de todos os candidatos de uma pasta do testset.

Uso: /caminho/venv/bin/python scripts/ocr_footers.py testset/<pasta> [n ...]
Requer: pip install rapidocr-onnxruntime pillow numpy
"""
import json, os, sys
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

ocr = RapidOCR()
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cache")


def read(im):
    w, h = im.size
    c = im.convert("RGB").crop((0, int(h * .90), int(w * .6), h))
    r, _ = ocr(np.asarray(c.resize((c.size[0] * 2, c.size[1] * 2))))
    return " | ".join(t[1] for t in (r or []))


d = sys.argv[1]
want = {int(x) for x in sys.argv[2:]}
meta = json.load(open(os.path.join(d, "candidates.json")))
print("REF", meta["ref"]["set"], meta["ref"]["cn"], "::", read(Image.open(os.path.join(d, "ref.jpg"))))
for c in meta["candidates"]:
    if want and c["n"] not in want:
        continue
    print(f"{c['n']:>2} {c['source'][:14]:<14} {c['dpi']:>4}  {read(Image.open(os.path.join(CACHE, f'mpc_{c['id']}.jpg')))}")
