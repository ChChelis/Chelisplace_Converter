"""Escolhe até 2 impressões variadas por carta (Scryfall) e gera folhas de contato de cada uma."""
import os, sys, time, json, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_contact_sheets import get, main

NAMES = [  # 12 cartas do deck de teste + 8 reimpressas famosas (casos difíceis)
    "Great Furnace", "Prismatic Strands", "Snuff Out", "Vault of Whispers", "Krark-Clan Shaman",
    "Avenging Hunter", "Generous Ent", "Lórien Revealed", "Writhing Chrysalis", "Nyxborn Hydra",
    "Sneaky Snacker", "Refurbished Familiar",
    "Sol Ring", "Lightning Bolt", "Swords to Plowshares", "Command Tower", "Counterspell",
    "Cultivate", "Rhystic Study", "Arcane Signet",
]
for name in NAMES:
    q = urllib.parse.quote(f'!"{name}" game:paper lang:en')
    d = get(f"https://api.scryfall.com/cards/search?q={q}&unique=prints&order=released", kind="json")["data"]
    time.sleep(0.1)
    d = [c for c in d if "image_uris" in c]
    seen, picks = set(), []
    for c in d:
        k = (c["frame"], c.get("border_color"), c.get("full_art"), tuple(c.get("frame_effects") or ()))
        if k not in seen:
            seen.add(k); picks.append(c)
    if len(picks) > 2:  # primeira e última variante distinta: máximo contraste
        picks = [picks[0], picks[-1]] if len(picks) == 2 else [picks[len(picks) // 3], picks[-1]]
    for c in picks:
        try:
            main(name, c["set"], c["collector_number"], 100)
        except Exception as e:  # uma carta ruim não derruba o lote
            print("FALHOU", name, c["set"], c["collector_number"], e, flush=True)
