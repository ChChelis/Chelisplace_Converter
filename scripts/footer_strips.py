"""Recorta o rodapé (código do set e número) da referência e de candidatos escolhidos.

Uso: python3 -I scripts/footer_strips.py testset/<pasta> 1 2 3 [saida.png]
"""
import json, os, sys
from PIL import Image

d, ns = sys.argv[1], [int(x) for x in sys.argv[2:] if x.isdigit()]
outp = next((a for a in sys.argv[2:] if a.endswith(".png")), "/tmp/claude-0/probe/strips.png")
cands = {c["n"]: c for c in json.load(open(os.path.join(d, "candidates.json")))["candidates"]}
cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cache")
ref = Image.open(os.path.join(d, "ref.jpg")).convert("RGB")
W, H = ref.size
strips = [("REF", ref.crop((0, int(H * .93), int(W * .6), H)))]
for n in ns:
    im = Image.open(os.path.join(cache, f"mpc_{cands[n]['id']}.jpg")).convert("RGB")
    w, h = im.size
    strips.append((str(n), im.crop((0, int(h * .90), int(w * .6), h))))
rows = [s.resize((560, max(1, int(560 * s.size[1] / s.size[0])))) for _, s in strips]
out = Image.new("RGB", (600, sum(r.size[1] + 10 for r in rows)), "white")
y = 0
from PIL import ImageDraw
dr = ImageDraw.Draw(out)
for (lab, _), r in zip(strips, rows):
    out.paste(r, (40, y)); dr.text((2, y + 4), lab, fill="red"); y += r.size[1] + 10
out.save(outp)
