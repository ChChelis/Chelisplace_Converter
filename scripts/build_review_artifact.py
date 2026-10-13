"""Empacota testset/ + pairs.json em catalog.json para a página de conferência.

Uso: python3 -I scripts/build_review_artifact.py <pasta_saida>
Cada carta leva: ref + até 16 candidatos (240x328) e o recorte do rodapé de cada um.
"""
import base64, io, json, os, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TS, CACHE = os.path.join(ROOT, "testset"), os.path.join(ROOT, "cache")


def uri(im, size, q=55):
    im = im.convert("RGB").resize(size)
    b = io.BytesIO(); im.save(b, "JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


def foot(im, w=260):
    iw, ih = im.size
    c = im.convert("RGB").crop((0, int(ih * .90), int(iw * .6), ih))
    return uri(c, (w, max(1, int(w * c.size[1] / c.size[0]))), 58)


def main(out):
    os.makedirs(out, exist_ok=True)
    pairs = json.load(open(os.path.join(TS, "pairs.json")))
    cards = []
    for d in sorted(pairs):
        meta = json.load(open(os.path.join(TS, d, "candidates.json")))
        ref = Image.open(os.path.join(TS, d, "ref.jpg"))
        cands = []
        for c in meta["candidates"]:
            try:
                im = Image.open(os.path.join(CACHE, f"mpc_{c['id']}.jpg"))
                cands.append({"n": c["n"], "id": c["id"], "name": c["name"], "source": c["source"], "dpi": c["dpi"], "img": uri(im, (208, 284)), "foot": foot(im)})
            except Exception as e:
                print("sem imagem", d, c["n"], e, file=sys.stderr)
        r = meta["ref"]
        cards.append({"id": d, "name": r["name"], "set": r["set"].upper(), "cn": r["cn"], "ref": uri(ref, (208, 290), 66), "refFoot": foot(ref), "prop": pairs[d], "cands": cands})
    path = os.path.join(out, "catalog.json")
    json.dump({"cards": cards}, open(path, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print(len(cards), "cartas;", round(os.path.getsize(path) / 1e6, 1), "MB")


main(sys.argv[1])
