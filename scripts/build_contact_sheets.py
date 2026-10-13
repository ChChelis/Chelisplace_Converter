"""Monta folhas de contato para rotular o conjunto de teste.

Uso: python3 -I scripts/build_contact_sheets.py "Snuff Out" mb2 187 [max_cands]
Saída em testset/<set>_<cn>_<slug>/: ref.jpg, sheet.jpg, candidates.json
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from io import BytesIO
from PIL import Image, ImageDraw
import numpy as np

UA = {"User-Agent": "chelisplace-bot/0.1 (chris.c.chelis@gmail.com)", "Accept": "*/*"}
MPC = "https://mpcfill.com"
ROOT = os.path.join(os.path.dirname(__file__), "..")
CACHE = os.path.join(ROOT, "cache")
os.makedirs(CACHE, exist_ok=True)


def get(url, data=None, kind="bytes"):
    h = dict(UA)
    if data is not None:
        h["Content-Type"] = "application/json"
        data = json.dumps(data).encode()
    raw = urllib.request.urlopen(urllib.request.Request(url, data, h), timeout=40).read()
    return json.loads(raw) if kind == "json" else raw


def cached_image(key, url, delay):
    p = os.path.join(CACHE, key)
    if not os.path.exists(p):
        time.sleep(delay)  # shortcut: sleep fixo, trocar por limitador se rodar em paralelo
        open(p, "wb").write(get(url))
    return Image.open(p).convert("RGB")


def feat(im):
    return np.asarray(im.resize((48, 66)), dtype=np.float32)


def main(name, sset, cn, cap=150):
    sf = get(f"https://api.scryfall.com/cards/{sset}/{cn}", kind="json")
    time.sleep(0.1)
    ref = cached_image(f"sf_{sset}_{cn}.jpg", sf["image_uris"]["large"], 0.1)
    src = get(MPC + "/2/sources/", kind="json")["results"]
    settings = {
        "filterSettings": {"excludesTags": [], "includesTags": [], "languages": [], "maximumDPI": 1500, "maximumSize": 30, "minimumDPI": 0},
        "searchTypeSettings": {"filterCardbacks": False, "fuzzySearch": False},
        "sourceSettings": {"sources": [[int(k), True] for k in src]},
    }
    q = sf["name"].split(" // ")[0]
    res = get(MPC + "/2/editorSearch/", {"queries": [{"query": q, "cardType": "CARD"}], "searchSettings": settings}, "json")["results"]
    ids = next(iter(res.values())).get("CARD", [])[:cap]
    cards = {}
    for i in range(0, len(ids), 200):
        cards.update(get(MPC + "/2/cards/", {"cardIdentifiers": ids[i:i + 200]}, "json")["results"])
    rf = feat(ref)
    scored = []
    for cid in ids:
        c = cards.get(cid)
        if not c:
            continue
        try:
            im = cached_image(f"mpc_{cid}.jpg", c["mediumThumbnailUrl"], 0.4)
        except Exception as e:  # thumbnail quebrada: segue
            print("skip", cid, e, file=sys.stderr)
            continue
        scored.append((float(np.abs(feat(im) - rf).mean()), cid, c, im))
    scored.sort(key=lambda t: t[0])
    top = scored[:16]
    out = os.path.join(ROOT, "testset", f"{sset}_{cn}_{re.sub('[^a-z0-9]+', '-', q.lower())}")
    os.makedirs(out, exist_ok=True)
    ref.save(os.path.join(out, "ref.jpg"), quality=88)
    W, H = 168, 230
    sheet = Image.new("RGB", (W * 5, H * 4), "white")
    d = ImageDraw.Draw(sheet)
    rr = ref.resize((W, H))
    sheet.paste(rr, (0, 0))
    d.text((4, 4), f"REF {sset} {cn}", fill="red")
    meta = []
    for n, (s, cid, c, im) in enumerate(top, 1):
        x, y = (n % 5) * W, (n // 5) * H
        sheet.paste(im.resize((W, H)), (x, y))
        d.rectangle([x, y, x + 22, y + 14], fill="black")
        d.text((x + 4, y + 2), str(n), fill="yellow")
        meta.append({"n": n, "id": cid, "name": c["name"], "source": c["sourceName"], "dpi": c["dpi"], "prefilter": round(s, 2)})
    sheet.save(os.path.join(out, "sheet.jpg"), quality=85)
    json.dump({"ref": {"name": sf["name"], "set": sset, "cn": cn}, "total_hits": len(res and ids), "candidates": meta}, open(os.path.join(out, "candidates.json"), "w"), ensure_ascii=False, indent=1)
    print(out, len(ids), "hits;", len(scored), "baixados")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 150)
