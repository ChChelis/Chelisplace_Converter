"""Pedido do Moxfield -> candidatos do MPCFill -> catálogo de conferência.

Uso (venv com rapidocr): venv/bin/python scripts/make_order.py lista.txt order/<nome>
Retomável: cada carta resolvida fica em order/<nome>/units/<id>.json.
Nada é decidido calado: o bot só PRÉ-SELECIONA; a conferência e o XML saem do artefato.
"""
import concurrent.futures as cf, io, json, os, re, sys, time, urllib.request
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compare as C
import deck_parse as D
from build_review_artifact import uri, foot

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CACHE = os.path.join(ROOT, "cache")
MPC = "https://mpcfill.com"
UA = {"User-Agent": "chelisplace-bot/0.1 (chris.c.chelis@gmail.com)"}
TOP = 12            # finalistas por carta (recebem OCR e aparecem na página)
CAP = 400           # máximo de candidatos lidos por busca
HI, MID, LO = 1.7, 0.9, 0.1   # limiares de nota (tabela leave-one-out em docs/fase1_sondagem.md)
CHEAP = [0, 1, 2, 3, 7]       # inteira, arte, moldura, borda, símbolo: sinais sem OCR
BRACKETS = [18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612]


def http(url, data=None):
    h = dict(UA)
    if data is not None:
        h["Content-Type"] = "application/json"; data = json.dumps(data).encode()
    return urllib.request.urlopen(urllib.request.Request(url, data, h), timeout=60).read()


def fetch_img(url, path):
    """Baixa e valida a imagem; nunca deixa arquivo quebrado no cache (bug do lote antigo)."""
    if os.path.exists(path):
        try:
            Image.open(path).load(); return True
        except Exception:
            os.remove(path)
    for a in range(3):
        try:
            raw = http(url); Image.open(io.BytesIO(raw)).load()
            open(path, "wb").write(raw); return True
        except Exception:
            time.sleep(1 + a)
    return False


def sources():
    return json.loads(http(MPC + "/2/sources/"))["results"]


def search(name, ctype, src):
    st = {"filterSettings": {"excludesTags": [], "includesTags": [], "languages": [], "maximumDPI": 1500, "maximumSize": 30, "minimumDPI": 0},
          "searchTypeSettings": {"filterCardbacks": False, "fuzzySearch": False},
          "sourceSettings": {"sources": [[int(k), True] for k in src]}}
    r = json.loads(http(MPC + "/2/editorSearch/", {"queries": [{"query": name, "cardType": ctype}], "searchSettings": st}))["results"]
    ids = next(iter(r.values()), {}).get(ctype, [])[:CAP]
    cards = {}
    for i in range(0, len(ids), 200):
        cards.update(json.loads(http(MPC + "/2/cards/", {"cardIdentifiers": ids[i:i + 200]}))["results"])
    return [cards[i] for i in ids if i in cards]


def models():
    X, y, grp, _ = C.dataset()
    return C.fit(X[:, CHEAP], y), C.fit(X, y)


def explain(f):
    out = ["rodapé igual" if f[4] >= .6 else ("rodapé ilegível" if f[5] == 1 else "rodapé diferente")]
    if f[7] < .35: out.append("símbolo do set não confere")
    if f[2] < .85: out.append("moldura diferente")
    if f[6] == 0: out.append("idioma diferente")
    return " · ".join(out)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:30]


def process_unit(uid, name, ref_url, ctype, is_sld, src, cheap, full, log):
    refp = os.path.join(CACHE, f"sf_{uid}.jpg")
    if not fetch_img(ref_url, refp):
        raise RuntimeError("sem imagem de referência")
    ref = C.load(refp)
    cands = search(name, ctype, src) or search(name, "TOKEN" if ctype == "CARD" else "CARD", src)
    log(f"  {len(cands)} candidatos")
    sp = lambda c: os.path.join(CACHE, f"mpcs_{c['identifier']}.jpg")
    with cf.ThreadPoolExecutor(4) as ex:
        ok = list(ex.map(lambda c: fetch_img(c["smallThumbnailUrl"], sp(c)), cands))
    cands = [c for c, o in zip(cands, ok) if o]
    xs = np.array([C.features(ref, set(), C.load(sp(c)), set())[0:8] for c in cands]) if cands else np.zeros((0, 8))
    if not len(cands):
        return {"id": uid, "name": name, "cands": [], "prop": {"accept": [], "near": [], "conf": "baixa", "note": "ALERTA: nenhum candidato no MPCFill"}}
    order = np.argsort(-C.score(cheap, xs[:, CHEAP]))[:TOP]
    top = [cands[i] for i in order]
    C.ocr_footer(refp, "ref_" + uid)
    rtok = C.tokens(C.footer_text("ref_" + uid))
    for c in top:
        mp = os.path.join(CACHE, f"mpc_{c['identifier']}.jpg")
        fetch_img(c["mediumThumbnailUrl"], mp); C.ocr_footer(mp, c["identifier"])
    rows = []
    for c in top:
        im = C.load(os.path.join(CACHE, f"mpc_{c['identifier']}.jpg"))
        f = C.features(ref, rtok, im, C.tokens(C.footer_text(c["identifier"])))
        rows.append((float(C.score(full, np.array([f]))[0]), c, f))
    rows.sort(key=lambda r: -r[0])
    best = rows[0][0]
    conf = "alta" if best >= HI else "media" if best >= MID else "baixa" if best >= LO else "nenhum"
    accept = [1] if conf != "nenhum" else []
    if is_sld and best < HI:  # regra do usuário: arte de Secret Lair tem que ser exata; senão, alerta
        accept, conf = [], "nenhum"
    note = ("ALERTA: Secret Lair com arte específica sem match seguro. Falar com o cliente: não tem, serve outra? " if is_sld and best < HI else "") + \
        f"melhor nota {best:.2f}: " + explain(rows[0][2])
    return {"id": uid, "name": name, "refp": refp,
            "cands": [{"n": i + 1, "id": c["identifier"], "name": c["name"], "source": c["sourceName"], "dpi": c["dpi"], "ext": c["extension"], "sc": round(s, 2), "why": explain(f)} for i, (s, c, f) in enumerate(rows)],
            "prop": {"accept": accept, "near": [n for n in (2, 3, 4)], "conf": conf, "note": note}}


def main(lista, out):
    os.makedirs(os.path.join(out, "units"), exist_ok=True)
    logf = open(os.path.join(out, "log.txt"), "a", encoding="utf-8")
    def log(m):
        print(m, flush=True); logf.write(m + "\n"); logf.flush()
    entries = [r for r in (D.resolve(D.parse_line(l)) for l in open(lista, encoding="utf-8") if l.strip() and D.parse_line(l))]
    src = sources(); cheap, full = models()
    units = []
    shard = os.environ.get("SHARD")  # "k/n": processa só as cartas com índice % n == k (várias execuções em paralelo)
    for i, e in enumerate(entries):
        if shard and i % int(shard.split("/")[1]) != int(shard.split("/")[0]):
            continue
        if not e["card"]:
            log(f"{i:03d} NÃO RESOLVIDA: {e['name']} {e['fixes']}"); continue
        names = e["name"].split(" // ")
        tokenish = e["card"]["layout"] in ("token", "double_faced_token", "emblem")
        for fi, url in enumerate(e["images"]):
            uid = f"{i:03d}_{e['card']['set']}_{e['card']['collector_number']}_{slug(names[min(fi, len(names) - 1)])}"
            up = os.path.join(out, "units", uid + ".json")
            if not os.path.exists(up):
                log(f"{uid}  ({e['qty']}x)")
                u = process_unit(uid, names[min(fi, len(names) - 1)].split(" // ")[0], url, "TOKEN" if tokenish else "CARD", e["card"]["set"] == "sld", src, cheap, full, log)
                u.update({"qty": e["qty"], "entry": i, "face": fi, "set": e["card"]["set"].upper(), "cn": e["card"]["collector_number"], "fixes": e["fixes"]})
                json.dump(u, open(up, "w", encoding="utf-8"), ensure_ascii=False)
            units.append(up)
    if not shard:
        build_catalog(units, out)


def build_catalog(unit_files, out):
    cards, chunks, cur, size = [], [], [], 0
    total_qty = 0
    for up in unit_files:
        u = json.load(open(up, encoding="utf-8"))
        if u["cands"]:  # empate técnico (até 0,25 da melhor nota): vence a maior resolução
            best = max(c["sc"] for c in u["cands"])
            tie = sorted([c for c in u["cands"] if c["sc"] >= best - .25], key=lambda c: (-c["dpi"], -c["sc"]))
            u["cands"] = tie + [c for c in u["cands"] if c["sc"] < best - .25]
            for i, c in enumerate(u["cands"]): c["n"] = i + 1
        refp = u.get("refp") or os.path.join(CACHE, f"sf_{u['id']}.jpg")
        ref = Image.open(refp)
        cands = []
        for c in u["cands"]:
            im = Image.open(os.path.join(CACHE, f"mpc_{c['id']}.jpg"))
            cands.append({**c, "img": uri(im, (208, 284)), "foot": foot(im)})
        card = {"id": u["id"], "name": u["name"], "set": u["set"], "cn": u["cn"], "qty": u["qty"], "entry": u["entry"], "face": u["face"],
                "ref": uri(ref, (208, 290), 66), "refFoot": foot(ref), "prop": u["prop"], "cands": cands, "fixes": u.get("fixes", [])}
        s = len(json.dumps(card, separators=(",", ":"), ensure_ascii=False))
        if size + s > 9_000_000 and cur:
            chunks.append(cur); cur, size = [], 0
        cur.append(card); size += s
        if u["face"] == 0: total_qty += u["qty"]
    if cur: chunks.append(cur)
    names = []
    for i, ch in enumerate(chunks):
        n = f"catalog_{i}.json"; names.append(n)
        json.dump({"cards": ch}, open(os.path.join(out, n), "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    bracket = next((b for b in BRACKETS if b >= total_qty), BRACKETS[-1])
    json.dump({"chunks": names, "order": {"quantity": total_qty, "bracket": bracket}}, open(os.path.join(out, "catalog.json"), "w"), ensure_ascii=False)
    print("catálogo:", len(unit_files), "unidades,", len(names), "arquivos; quantidade", total_qty, "bracket", bracket)


if __name__ == "__main__":
    if sys.argv[1] == "rebuild":
        d = sys.argv[2]; build_catalog(sorted(os.path.join(d, "units", f) for f in os.listdir(os.path.join(d, "units"))), d)
    else:
        main(sys.argv[1], sys.argv[2])
