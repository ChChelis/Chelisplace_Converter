"""Pedido do Moxfield -> candidatos do MPCFill -> catálogo de conferência.

Uso (venv com rapidocr): venv/bin/python scripts/make_order.py lista.txt order/<nome>
Retomável: cada carta resolvida fica em order/<nome>/units/<id>.json.
Nada é decidido calado: o bot só PRÉ-SELECIONA; a conferência e o XML saem do artefato.
"""
import concurrent.futures as cf, io, json, os, re, shutil, sys, time, urllib.error, urllib.request
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import calibrate as CAL
import compare as C
import deck_parse as D
from build_review_artifact import uri, foot

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CACHE = os.path.join(ROOT, "cache")
MPC = "https://mpcfill.com"
UA = {"User-Agent": "chelisplace-bot/0.1 (chris.c.chelis@gmail.com)"}
TOP = 12            # finalistas por carta (recebem OCR e aparecem na página)
TOP2 = 30           # finalistas das cartas de nota baixa (segunda passada)
CAP = 800           # máximo de candidatos lidos por busca (Sol Ring tem 719)
HI, MID, LO = 2.6, 2.0, 1.0   # limiares de nota; recalibrar quando retreinar (tabela leave-one-out de `compare.py eval`, depois do corte de sangria)
CHEAP = [0, 1, 2, 3, 7]       # inteira, arte, moldura, borda, símbolo: sinais sem OCR
IDX_ALTA, IDX_MEDIA, IDX_BAIXA = 85, 70, 50  # faixas do índice de confiança (%)
LIGA_SHIFT = 1.4  # imagens da LigaMagic pontuam ~1,4 abaixo das do Scryfall (menores, às vezes em português); faixas NÃO calibradas com decisões do usuário
PAIR_BONUS = 1.0  # verso da mesma fonte que a frente escolhida ganha esta nota extra (frente e verso devem combinar)
BASICS = {"Island", "Plains", "Swamp", "Mountain", "Forest", "Wastes"}
LANGS = {"PT", "FR", "ES", "DE", "IT", "JA", "JP", "KO", "RU", "ZH", "CS", "CT", "PH", "TW", "CN"}
BRACKETS = [18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612]


def http(url, data=None):
    h = dict(UA)
    if data is not None:
        h["Content-Type"] = "application/json"; data = json.dumps(data).encode()
    for a in range(6):  # 429/5xx: o MPCFill limita requisições; espera e tenta de novo
        try:
            return urllib.request.urlopen(urllib.request.Request(url, data, h), timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503, 504, 520, 521, 522, 523, 524) or a == 5:
                raise
            time.sleep(float(e.headers.get("Retry-After") or 0) or 6 * (a + 1))


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
    """Treina (ou lê do cache) os dois modelos; o cache vale enquanto gabaritos e compare.py não mudam."""
    import glob, hashlib
    h = hashlib.md5()
    for fp in sorted(glob.glob(os.path.join(ROOT, "order", "*", "gabarito.json")) + [os.path.join(ROOT, "testset", "gabarito.json"), os.path.join(ROOT, "scripts", "compare.py")]):
        h.update(open(fp, "rb").read())
    path = os.path.join(CACHE, f"model_{h.hexdigest()[:10]}.json")
    if os.path.exists(path):
        d = json.load(open(path))
        return tuple((np.array(m[0]), np.array(m[1]), np.array(m[2]), float(m[3])) for m in d)
    X, y, grp, _ = C.dataset()
    ms = (C.fit(X[:, CHEAP], y), C.fit(X, y))
    json.dump([[list(map(float, m[0])), list(map(float, m[1])), list(map(float, m[2])), float(m[3])] for m in ms], open(path, "w"))
    return ms


def conf_of(best, is_sld, seen):
    """Faixa de confiança; recalculada ao montar o catálogo, então mudar os limiares vale para unidades já processadas."""
    if seen:
        return "alta"
    c = "alta" if best >= HI else "media" if best >= MID else "baixa" if best >= LO else "nenhum"
    return "nenhum" if is_sld and best < HI else c


def explain(f):
    out = ["rodapé igual" if f[4] >= .6 else ("rodapé ilegível" if f[5] == 1 else "rodapé diferente")]
    if f[7] < .35: out.append("símbolo do set não confere")
    if f[2] < .85: out.append("moldura diferente")
    if f[6] == 0: out.append("idioma diferente")
    return " · ".join(out)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:30]


def memory():
    """Escolhas já confirmadas pelo usuário: (set, número, face) -> ids aceitos, em ordem de preferência."""
    mem = {}
    tg = os.path.join(ROOT, "testset", "gabarito.json")
    for k, v in (json.load(open(tg)) if os.path.exists(tg) else {}).items():
        if v["status"] == "ok" and v.get("accept_ids"):
            r = json.load(open(os.path.join(ROOT, "testset", k, "candidates.json")))["ref"]
            mem[(r["set"].lower(), str(r["cn"]).lower(), 0)] = v["accept_ids"]
    od = os.path.join(ROOT, "order")
    for name in sorted(os.listdir(od)) if os.path.isdir(od) else []:
        gp = os.path.join(od, name, "gabarito.json")
        if not os.path.exists(gp):
            continue
        for uid, v in json.load(open(gp)).items():
            if v["status"] == "ok" and v.get("accept_ids") and not v.get("excluded"):
                u = json.load(open(os.path.join(od, name, "units", uid + ".json")))
                mem[(u["set"].lower(), str(u["cn"]).lower(), u["face"])] = v["accept_ids"]  # pedido mais recente vence
    return mem


def exact_print(front_uid, front_name):
    """Set e número lidos (OCR) no rodapé da imagem da Liga -> impressão exata no Scryfall, para trazer o verso da MESMA impressão."""
    txt = C.footer_text("ref_" + front_uid)
    sets = [t.lower() for t in re.findall(r"[A-Z][A-Z0-9]{1,3}", txt.upper()) if t not in LANGS and t != "EN"][:4]
    nums = [n.lstrip("0") or "0" for n in re.findall(r"\d{1,4}[A-Za-z]?", txt)][:4]
    for st_ in sets:
        for n in nums:
            d = D.scry(f"/cards/{st_}/{n}")
            if d and d["name"].split(" // ")[0].lower() == front_name.lower() and len(d.get("card_faces", [])) > 1:
                return d
    return None


def process_unit(uid, name, ref_url, ctype, is_sld, src, cheap, full, log, mem_ids=(), prefer_src=None):
    refp = os.path.join(CACHE, f"sf_{uid}.jpg")
    if os.path.exists(ref_url):  # referência local (ex.: imagem da página da LigaMagic)
        shutil.copy(ref_url, refp)
    elif not fetch_img(ref_url, refp):
        raise RuntimeError("sem imagem de referência")
    ref = C.load(refp)
    cands = search(name, ctype, src) or search(name, "TOKEN" if ctype == "CARD" else "CARD", src)
    log(f"  {len(cands)} candidatos")
    fast = [c for mid in mem_ids for c in cands if c["identifier"] == mid]
    if fast:  # você já escolheu esta impressão antes: só confirma que ainda existe e pula o carregamento pesado
        log("  escolha lembrada: sem busca pesada")
        fetch_img(fast[0]["mediumThumbnailUrl"], os.path.join(CACHE, f"mpc_{fast[0]['identifier']}.jpg"))
        c = fast[0]
        return {"id": uid, "name": name, "refp": refp, "cands": [{"n": 1, "id": c["identifier"], "name": c["name"], "source": c["sourceName"], "dpi": c["dpi"], "ext": c["extension"], "t": c.get("cardType"), "q": c.get("searchq"), "sc": None, "why": "escolhida por você antes", "mem": True}],
                "prop": {"accept": [1], "near": [], "conf": "alta", "note": "Escolhida por você em pedido anterior (sem alternativas carregadas)."}}
    sp = lambda c: os.path.join(CACHE, f"mpcs_{c['identifier']}.jpg")
    with cf.ThreadPoolExecutor(4) as ex:
        ok = list(ex.map(lambda c: fetch_img(c["smallThumbnailUrl"], sp(c)), cands))
    cands = [c for c, o in zip(cands, ok) if o]
    xs = np.array([C.features(ref, set(), C.load(sp(c)), set())[0:8] for c in cands]) if cands else np.zeros((0, 8))
    if not len(cands):
        return {"id": uid, "name": name, "cands": [], "prop": {"accept": [], "near": [], "conf": "baixa", "note": "ALERTA: nenhum candidato no MPCFill"}}
    order = np.argsort(-C.score(cheap, xs[:, CHEAP]))
    C.ocr_footer(refp, "ref_" + uid)
    rtok = {"EN" if t in LANGS else t for t in C.tokens(C.footer_text("ref_" + uid))}

    def rank(n):
        top = [cands[i] for i in order[:n]]
        top += [c for c in cands if c["identifier"] in mem_ids and c not in top]  # as já escolhidas por você sempre concorrem
        for c in top:
            mp = os.path.join(CACHE, f"mpc_{c['identifier']}.jpg")
            fetch_img(c["mediumThumbnailUrl"], mp); C.ocr_footer(mp, c["identifier"])
        out = []
        for c in top:
            f = C.features(ref, rtok, C.load(os.path.join(CACHE, f"mpc_{c['identifier']}.jpg")), C.tokens(C.footer_text(c["identifier"])))
            out.append((float(C.score(full, np.array([f]))[0]) + (PAIR_BONUS if prefer_src and c["sourceName"] == prefer_src else 0.0), c, f))
        return sorted(out, key=lambda r: -r[0])

    rows = rank(TOP)
    if rows[0][0] < MID and len(cands) > TOP:  # carta duvidosa: amplia os finalistas
        log(f"  nota {rows[0][0]:.2f}: ampliando para {TOP2} finalistas")
        rows = rank(TOP2)
    seen = [r for r in rows if r[1]["identifier"] in mem_ids]
    if seen:  # escolha que você já confirmou antes vence a nota
        first = min(seen, key=lambda r: list(mem_ids).index(r[1]["identifier"]))
        rows.remove(first); rows.insert(0, first)
    best = rows[0][0]
    conf = conf_of(best, is_sld, bool(seen))
    accept = [1]  # regra do usuário (pedido 1): nunca deixar a carta de fora, pré-seleciona a mais próxima e avisa
    note = ("Escolhida por você em pedido anterior. " if seen else "") + ("ALERTA: não achei a versão pedida; esta é a mais próxima. Falar com o cliente: não tem, serve outra? " if conf == "nenhum" else "") + \
        f"melhor nota {best:.2f}: " + explain(rows[0][2])
    return {"id": uid, "name": name, "refp": refp,
            "cands": [{"n": i + 1, "id": c["identifier"], "name": c["name"], "source": c["sourceName"], "dpi": c["dpi"], "ext": c["extension"], "t": c.get("cardType"), "q": c.get("searchq"), "sc": round(s, 2), "why": explain(f), **({"mem": True} if i == 0 and seen else {})} for i, (s, c, f) in enumerate(rows)],
            "pair_src": prefer_src, "prop": {"accept": accept, "near": [n for n in (2, 3, 4)], "conf": conf, "note": note}}


def main(lista, out):
    os.makedirs(os.path.join(out, "units"), exist_ok=True)
    logf = open(os.path.join(out, "log.txt"), "a", encoding="utf-8")
    def log(m):
        print(m, flush=True); logf.write(m + "\n"); logf.flush()
    entries = [r for r in (D.resolve(D.parse_line(l)) for l in open(lista, encoding="utf-8") if l.strip() and D.parse_line(l))]
    src = sources(); cheap, full = models(); mem = memory()
    mt = os.path.join(out, "model.txt")
    if not os.path.exists(mt):
        open(mt, "w").write(C.data_key())
    refs = json.load(open(os.environ["REFS"], encoding="utf-8")) if os.environ.get("REFS") else {}
    units = []
    shard = os.environ.get("SHARD")  # "k/n": processa só as cartas com índice % n == k (várias execuções em paralelo)
    for i, e in enumerate(entries):
        if not e["card"] and e["name"] in refs:  # nome que o Scryfall não resolve, mas tenho a imagem da LigaMagic
            e = {**e, "card": {"name": e["name"], "set": "liga", "collector_number": "", "layout": "normal"}, "images": [refs[e["name"]]], "fixes": e["fixes"] + ["sem Scryfall: só a imagem da LigaMagic"]}
        if shard and i % int(shard.split("/")[1]) != int(shard.split("/")[0]):
            continue
        if not e["card"]:
            log(f"{i:03d} NÃO RESOLVIDA: {e['name']} {e['fixes']}"); continue
        names = e["card"]["name"].split(" // ") if len(e["images"]) > 1 else e["name"].split(" // ")  # a lista da Liga traz só o nome da frente
        last_front = None
        tokenish = e["card"]["layout"] in ("token", "double_faced_token", "emblem")
        for fi, url in enumerate(e["images"]):
            liga = fi == 0 and e["name"] in refs  # imagem de referência vinda da LigaMagic: set/número do Scryfall seriam palpite
            if liga:
                url = refs[e["name"]]
            cset, ccn = e["card"]["set"], e["card"]["collector_number"]
            if fi == 1 and e["name"] in refs and last_front:  # verso de carta dupla-face: tenta a mesma impressão da frente da Liga
                ex = exact_print(last_front["uid"], names[0])
                if ex:
                    url = ex["card_faces"][1]["image_uris"]["large"]; cset, ccn = ex["set"], ex["collector_number"]
                    log(f"  verso: impressão da Liga identificada pelo rodapé: {cset} {ccn}")
            uid = (f"{i:03d}_liga_{slug(e['name'])}" if liga else f"{i:03d}_{cset}_{ccn}_{slug(names[min(fi, len(names) - 1)])}")
            up = os.path.join(out, "units", uid + ".json")
            if not os.path.exists(up):
                log(f"{uid}  ({e['qty']}x)")
                u = process_unit(uid, names[min(fi, len(names) - 1)].split(" // ")[0], url, "TOKEN" if tokenish else "CARD", (not liga) and cset == "sld", src, cheap, full, log, [] if liga else mem.get((cset.lower(), str(ccn).lower(), fi), []), last_front["src"] if (fi == 1 and last_front) else None)
                u.update({"qty": e["qty"], "entry": i, "face": fi, "set": "LIGA" if liga else cset.upper(), "cn": "" if liga else ccn, "fixes": [] if (liga or e["name"] in refs) else e["fixes"]})
                json.dump(u, open(up, "w", encoding="utf-8"), ensure_ascii=False)
            if fi == 0:
                uj = json.load(open(up, encoding="utf-8")); last_front = {"uid": uid, "src": uj["cands"][0]["source"] if uj["cands"] else None}
            units.append(up)
    if not shard:
        build_catalog(units, out)


def fill_meta(unit_files):
    """Unidades antigas não guardam tipo (CARD/TOKEN) e searchq do candidato: busca no MPCFill e grava."""
    need = {}
    units = {}
    for up in unit_files:
        u = json.load(open(up, encoding="utf-8")); units[up] = u
        for c in u["cands"]:
            if "t" not in c: need[c["id"]] = None
    ids = list(need)
    for i in range(0, len(ids), 200):
        for k, v in json.loads(http(MPC + "/2/cards/", {"cardIdentifiers": ids[i:i + 200]}))["results"].items():
            need[k] = (v.get("cardType"), v.get("searchq"))
    for up, u in units.items():
        ch = False
        for c in u["cands"]:
            if "t" not in c and need.get(c["id"]):
                c["t"], c["q"] = need[c["id"]]; ch = True
        if ch: json.dump(u, open(up, "w", encoding="utf-8"), ensure_ascii=False)


def build_catalog(unit_files, out):
    fill_meta(unit_files)
    mt = os.path.join(out, "model.txt")  # modelo com que o pedido foi processado; só pedidos com o modelo atual usam o índice
    cal = CAL.load() if os.path.exists(mt) and open(mt).read().strip() == C.data_key() else None
    cards, chunks, cur, size = [], [], [], 0
    total_qty = 0
    for up in unit_files:
        u = json.load(open(up, encoding="utf-8"))
        if u["cands"]:  # confiança: índice calibrado (pedidos novos) ou limiares antigos (pedidos legados)
            seen = any(c.get("mem") for c in u["cands"]); best0 = max((c["sc"] for c in u["cands"] if c["sc"] is not None), default=-9.0)
            liga = u["set"] == "LIGA"
            if cal:
                idx = 99 if seen else CAL.index(cal, best0, "liga" if liga else "scry")
                conf = "alta" if idx >= IDX_ALTA else "media" if idx >= IDX_MEDIA else "baixa" if idx >= IDX_BAIXA else "nenhum"
                if u["set"] == "SLD" and not seen and idx < IDX_ALTA:
                    conf = "nenhum"  # Secret Lair: arte específica, só vale a exata
                u["prop"]["idx"] = idx
            else:
                conf = conf_of(best0 + (LIGA_SHIFT if liga else 0), u["set"] == "SLD", seen)
            u["prop"]["conf"] = conf
            note = u["prop"]["note"]; k = note.find("melhor nota")
            if k >= 0:  # refaz os avisos com a confiança atual
                u["prop"]["note"] = ("Escolhida por você em pedido anterior. " if seen else "") + (f"Índice de confiança {u['prop']['idx']}%. " if cal else "") + \
                    ("ALERTA: não achei a versão pedida; esta é a mais próxima. Falar com o cliente: não tem, serve outra? " if conf == "nenhum" else "") + note[k:] + \
                    (" Terreno básico: o MPCFill tem milhares de artes; pode haver uma melhor além das 800 primeiras." if liga and u["name"] in BASICS else "")
        if u["cands"] and not any(c.get("mem") for c in u["cands"]):  # empate técnico (até 0,25 da melhor nota): vence a maior resolução
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
    liga_any = any(json.load(open(up, encoding="utf-8")).get("set") == "LIGA" for up in unit_files)
    onote = ("O índice de cada carta é a chance estimada de você aceitar a escolha do bot, calculada com as suas decisões anteriores (referências " + ("da Liga" if liga_any else "do Scryfall") + "). Audite só o que quiser; o painel do XML aceita um índice mínimo para entrar sem auditoria.") if cal else ("A referência de cada carta é a imagem da LigaMagic. As faixas de confiança ainda não foram calibradas para essas imagens: confira todas." if liga_any else "")
    json.dump({"chunks": names, "order": {"quantity": total_qty, "bracket": bracket, "note": onote}}, open(os.path.join(out, "catalog.json"), "w"), ensure_ascii=False)
    print("catálogo:", len(unit_files), "unidades,", len(names), "arquivos; quantidade", total_qty, "bracket", bracket)


if __name__ == "__main__":
    if sys.argv[1] == "rebuild":
        d = sys.argv[2]; build_catalog(sorted(os.path.join(d, "units", f) for f in os.listdir(os.path.join(d, "units"))), d)
    else:
        main(sys.argv[1], sys.argv[2])
