"""Importa um arquivo de usos exportado pelo aplicativo (usos_AAAAMMDD_HHMM.json) para o repositório.

Uso: venv/bin/python scripts/import_usage.py /caminho/usos.json
Para cada pedido do arquivo:
  - cria order/<nome>/ com lista.txt, units/ e gabarito.json (só decisões 'ok'; 'nenhum' vira excluded; aceites em lote sem conferir viram bulk);
  - baixa de novo as imagens de referência e dos candidatos (o arquivo de usos não leva imagens);
Também grava os uploaders de confiança em config/uploaders.json e os eventos em uso/.
Depois: compare.py eval, calibrate.py e export_model.py geram o modelo novo (modelo.json) para devolver ao usuário.
Nomes que já existem em order/ ganham o sufixo _app para não sobrescrever nada.
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compare as C
import make_order as M

src = json.load(open(sys.argv[1], encoding="utf-8"))
assert src.get("formato") == 1, "formato de usos desconhecido"
ROOT = C.ROOT
novos = []
for p in src["pedidos"]:
    nome = p["nome"]
    while os.path.exists(os.path.join(ROOT, "order", nome)):
        nome += "_app"
    od = os.path.join(ROOT, "order", nome)
    os.makedirs(os.path.join(od, "units"), exist_ok=True)
    open(os.path.join(od, "lista.txt"), "w", encoding="utf-8").write(p["lista"])
    gab, falta = {}, []
    for uid, u in p["unidades"].items():
        u["refp"] = os.path.join(C.CACHE, f"sf_{uid}.jpg")
        json.dump(u, open(os.path.join(od, "units", uid + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
        d = p["decisoes"].get(uid)
        if not d or d.get("status") not in ("ok", "nenhum"):
            continue  # pendente e dúvida não são veredito
        ids = []
        if d["status"] == "ok":
            ids = [k["id"] for k in u["cands"] if k["n"] in d["accept"]][:1]
            if not ids:
                continue
        bulk = d.get("via") == "lote" and not d.get("conferido")
        gab[uid] = {"status": d["status"], "accept_ids": ids, "note": d.get("note", ""), "bot_conf": u["prop"]["conf"], "confirmed_at": d.get("at"),
                    "reviewed_one_by_one": not bulk, **({"bulk": True} if bulk else {}), **({"excluded": True} if d["status"] == "nenhum" else {})}
        if u.get("ref_url"):
            falta.append((uid, u["ref_url"]))
    json.dump(gab, open(os.path.join(od, "gabarito.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # imagens: referência (Scryfall) e miniaturas médias dos candidatos
    for uid, url in falta:
        if not M.fetch_img(url, os.path.join(C.CACHE, f"sf_{uid}.jpg")):
            print("sem referência:", uid)
    ids = sorted({k["id"] for uid in gab for k in p["unidades"][uid]["cands"] if not os.path.exists(os.path.join(C.CACHE, f"mpc_{k['id']}.jpg"))})
    for i in range(0, len(ids), 200):
        cards = json.loads(M.http(M.MPC + "/2/cards/", {"cardIdentifiers": ids[i:i + 200]}))["results"]
        for cid, c in cards.items():
            M.fetch_img(c["mediumThumbnailUrl"], os.path.join(C.CACHE, f"mpc_{cid}.jpg"))
    nb = sum(1 for g in gab.values() if g.get("bulk"))
    print(f"{nome}: {len(gab)} decisões no gabarito ({nb} em lote sem conferir), {len(ids)} imagens de candidatos baixadas")
    novos.append(nome)

up = src.get("uploaders", {}).get("trusted")
if up is not None:
    os.makedirs(os.path.join(ROOT, "config"), exist_ok=True)
    json.dump({"trusted": sorted(up)}, open(os.path.join(ROOT, "config", "uploaders.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print("uploaders de confiança:", len(up))
os.makedirs(os.path.join(ROOT, "uso"), exist_ok=True)
ev = os.path.join(ROOT, "uso", f"eventos_{src['exportado_em'][:10]}.jsonl")
open(ev, "w", encoding="utf-8").write("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in src.get("eventos", [])))
print("eventos:", len(src.get("eventos", [])), "->", ev, "| pedidos novos:", novos)
