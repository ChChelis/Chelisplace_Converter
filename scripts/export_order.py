"""Decisões do artefato (JSON baixados) + catálogo -> gabarito.json e pedido.xml do pedido.

Uso: python3 -I scripts/export_order.py order/<pedido> <pasta_com_decisões> [--bot]
Mesma regra do botão do artefato: só entra o que foi conferido ('ok'); 'nenhum' com nota fica de fora e vira `excluded`.
"""
import glob, json, os, sys
from xml.sax.saxutils import escape

BR = [18, 36, 55, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 396, 504, 612]
CARDBACK = "16g2UamJ2jzwNHovLesvsinvd6_qPkZfy"
od, dec = sys.argv[1], sys.argv[2]
cards = [c for n in json.load(open(os.path.join(od, "catalog.json")))["chunks"] for c in json.load(open(os.path.join(od, n)))["cards"]]
D = {os.path.basename(f)[:-5]: json.load(open(f)) for f in glob.glob(os.path.join(dec, "*.json"))}


def card_xml(k, slots, q):
    nm = k["name"] if k["name"].lower().endswith((".png", ".jpg", ".jpeg", ".webp")) else f"{k['name']}.{k.get('ext') or 'png'}"
    pre = "t:" if k["t"] == "TOKEN" else "b:" if k["t"] == "CARDBACK" else ""
    return f"    <card>\n      <id>{escape(k['id'])}</id>\n      <slots>{','.join(map(str, slots))}</slots>\n      <name>{escape(nm)}</name>\n      <query>{escape(pre + (k.get('q') or q.lower()))}</query>\n    </card>\n"


def pick(c):
    d = D.get(c["id"])
    if not d or d["status"] != "ok" or not d["accept"]:
        return None
    return next((k for k in c["cands"] if k["n"] == d["accept"][0]), None)


def bulk_ids():
    """Decisões gravadas em rajada (intervalo < 1 s, 10 ou mais seguidas) vêm do botão 'aceitar sem alerta', não de conferência carta a carta."""
    from datetime import datetime
    ts = sorted((datetime.fromisoformat(d["at"].replace("Z", "+00:00")), i) for i, d in D.items() if d.get("at"))
    out, run = set(), [ts[0]] if ts else []
    for a, b in zip(ts, ts[1:]):
        if (b[0] - a[0]).total_seconds() < 1: run.append(b)
        else:
            if len(run) >= 10: out |= {i for _, i in run}
            run = [b]
    if len(run) >= 10: out |= {i for _, i in run}
    return out


BULK = bulk_ids()
gab, by = {}, {}
for c in cards:
    d = D.get(c["id"])
    if not d: continue
    k = pick(c)
    gab[c["id"]] = {"status": d["status"], "accept_ids": [k["id"]] if k else [], "note": d.get("note", ""), "bot_conf": c["prop"]["conf"],
                    "confirmed_at": d.get("at"), "reviewed_one_by_one": c["id"] not in BULK, **({"bulk": True} if c["id"] in BULK else {}), **({"excluded": True} if d["status"] == "nenhum" else {})}
    by.setdefault(c["entry"], {})[c["face"]] = c
json.dump(gab, open(os.path.join(od, "gabarito.json"), "w"), ensure_ascii=False, indent=1)

slot, fr, bk, used, skipped = 0, "", "", 0, []
for e in sorted(by):
    f, b = by[e].get(0), by[e].get(1)
    kf = f and pick(f)
    if not kf:
        if f: skipped.append(f"{f['name']} ×{f['qty']}")
        continue
    slots = list(range(slot, slot + f["qty"])); slot += f["qty"]; used += f["qty"]
    fr += card_xml(kf, slots, f["name"])
    kb = b and pick(b)
    if kb: bk += card_xml(kb, slots, b["name"])
    elif b: skipped.append(f"{b['name']} (verso)")
bracket = next((v for v in BR if v >= used), BR[-1])
xml = (f'<?xml version="1.0" encoding="UTF-8"?>\n<order>\n  <details>\n    <quantity>{used}</quantity>\n    <bracket>{bracket}</bracket>\n    <stock>(S30) Standard Smooth</stock>\n'
       f'    <foil>false</foil>\n  </details>\n  <fronts>\n{fr}  </fronts>\n' + (f"  <backs>\n{bk}  </backs>\n" if bk else "") + f"  <cardback>{CARDBACK}</cardback>\n</order>\n")
open(os.path.join(od, "pedido.xml"), "w", encoding="utf-8").write(xml)
print(f"gabarito: {len(gab)} decisões ({len(BULK)} em rajada, sem conferência individual); XML: {used} cartas, moldura {bracket}; fora: {skipped}")
for c in cards:
    n = D.get(c["id"], {}).get("note")
    if n: print("nota:", c["name"], "->", n)
