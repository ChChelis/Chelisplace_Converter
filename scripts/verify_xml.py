"""Verifica um XML de pedido como o editor do MPC Autofill: <query> (com prefixo de tipo) + busca -> o <id> tem que aparecer.

Uso: python3 -I scripts/verify_xml.py order/<pedido>/pedido.xml
O editor ignora o id quando ele não está nos resultados da busca e mostra outra carta ou 'Card Not Found'.
"""
import json, re, sys, time, urllib.request
import xml.etree.ElementTree as ET

H = {"User-Agent": "chelisplace-bot/0.1", "Content-Type": "application/json"}
TYPES = {"": "CARD", "t": "TOKEN", "b": "CARDBACK"}


def post(p, b):
    return json.load(urllib.request.urlopen(urllib.request.Request("https://mpcfill.com" + p, json.dumps(b).encode(), H), timeout=90))


src = json.loads(urllib.request.urlopen(urllib.request.Request("https://mpcfill.com/2/sources/", headers=H), timeout=60).read())["results"]
st = {"filterSettings": {"excludesTags": [], "includesTags": [], "languages": [], "maximumDPI": 1500, "maximumSize": 30, "minimumDPI": 0},
      "searchTypeSettings": {"filterCardbacks": False, "fuzzySearch": False}, "sourceSettings": {"sources": [[int(k), True] for k in src]}}
root = ET.parse(sys.argv[1]).getroot()
bad = n = 0
for sec in ("fronts", "backs"):
    for c in root.find(sec) if root.find(sec) is not None else []:
        n += 1
        m = re.match(r"^(?:(t|b):)?(.*)$", c.find("query").text or "")
        t, q = TYPES[m.group(1) or ""], m.group(2)
        r = post("/2/editorSearch/", {"queries": [{"query": q, "cardType": t}], "searchSettings": st})["results"]
        if c.find("id").text not in next(iter(r.values()), {}).get(t, []):
            bad += 1; print("FORA DA BUSCA:", sec, t, repr(q), c.find("name").text)
        time.sleep(0.2)
print(f"{n} cartas verificadas, {bad} fora da busca do editor")
sys.exit(1 if bad else 0)
