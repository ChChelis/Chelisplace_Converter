"""Lê a lista do Moxfield e resolve cada linha para a impressão do Scryfall.

Quando algo dá errado, aplica uma troca automática e registra em `fixes`
(o relatório mostra todas; nada é corrigido em silêncio).

Uso: python3 -I scripts/deck_parse.py testset/deck_exemplo.txt
"""
import json, re, sys, time, urllib.error, urllib.parse, urllib.request

UA = {"User-Agent": "chelisplace-bot/0.1 (chris.c.chelis@gmail.com)", "Accept": "application/json"}
LINE = re.compile(r"^(\d+)x?\s+(.+?)(?:\s+\((\w+)\)\s+(\S+?))?(?:\s+\*[A-Za-z]\*)?\s*$")


def scry(path):
    time.sleep(0.1)  # shortcut: sleep fixo (limite do Scryfall é ~10/s), trocar por limitador se paralelizar
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request("https://api.scryfall.com" + path, headers=UA), timeout=20))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def norm(name):
    """Regra 1: ' / ' vira ' // ' (o Moxfield usa um traço só em alguns tokens)."""
    return re.sub(r"\s+/{1,2}\s+", " // ", name.strip())


def parse_line(line):
    m = LINE.match(line.strip())
    if not m:
        return None
    qty, name, sset, cn = m.groups()
    return {"qty": int(qty), "name": norm(name), "set": sset and sset.lower(), "cn": cn}


def same_name(a, b):
    return norm(a).lower().split(" // ")[0] == norm(b).lower().split(" // ")[0]


def resolve(entry):
    """Devolve o dict da linha com `card` (Scryfall), `images` (1 por face) e `fixes`."""
    fixes = []
    card = scry(f"/cards/{entry['set']}/{urllib.parse.quote(entry['cn'])}") if entry["set"] else None
    if card is None and entry["set"]:  # Regra 2: número com zeros à esquerda ou sufixo estranho
        cn = entry["cn"].lstrip("0") or "0"
        card = scry(f"/cards/{entry['set']}/{urllib.parse.quote(cn)}")
        if card:
            fixes.append(f"número {entry['cn']} -> {cn}")
    if card is not None and not same_name(card["name"], entry["name"]):  # Regra 3: set/número apontam para outra carta
        fixes.append(f"set/número davam '{card['name']}', esperado '{entry['name']}'")
        card = None
    if card is None:  # Regra 4: busca pelo nome dentro do set; senão, qualquer set
        q = urllib.parse.quote(entry["name"])
        # sem busca aproximada: fuzzy trocou "Sol Rng" por "Oathsworn Giant"; nome errado vai para revisão manual
        card = (entry["set"] and scry(f"/cards/named?exact={q}&set={entry['set']}")) or scry(f"/cards/named?exact={q}")
        if card:
            fixes.append(f"impressão adivinhada: {card['set']} {card['collector_number']}")
    if card is None:
        return {**entry, "card": None, "images": [], "fixes": fixes + ["NÃO ENCONTRADA: revisar à mão"]}
    # Regra 5: dupla-face (inclusive token) não tem image_uris no topo; usa 1 imagem por face
    faces = card.get("card_faces") if "image_uris" not in card else None
    images = [f["image_uris"]["large"] for f in faces] if faces else [card["image_uris"]["large"]]
    return {**entry, "card": {k: card[k] for k in ("name", "set", "collector_number", "layout")}, "images": images, "fixes": fixes}


if __name__ == "__main__":
    # auto-verificação offline das regras de leitura
    assert parse_line("4 Avenging Hunter (CLB) 215") == {"qty": 4, "name": "Avenging Hunter", "set": "clb", "cn": "215"}
    assert parse_line("1 Undercity / The Initiative (TCLB) 20")["name"] == "Undercity // The Initiative"
    assert parse_line("1x Sol Ring (C21) 263 *F*")["cn"] == "263"
    assert parse_line("3 Island")["set"] is None
    for line in open(sys.argv[1], encoding="utf-8"):
        if line.strip():
            r = resolve(parse_line(line))
            print(f"{r['qty']}x {r['name']} ->", r["card"] and f"{r['card']['set']} {r['card']['collector_number']}", f"({len(r['images'])} img)", r["fixes"] or "")
