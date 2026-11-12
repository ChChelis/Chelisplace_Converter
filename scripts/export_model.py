"""Empacota o modelo treinado (pesos + calibração) em app/modelo/modelo.json para o aplicativo.

Uso: venv/bin/python scripts/export_model.py
O aplicativo lê esse arquivo e não treina nada; para atualizar o bot basta trocar o arquivo (botão "Importar atualização" no app).
"""
import json, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import calibrate as CAL
import compare as C
import make_order as M

ms = M.models()
out = {"key": C.data_key(), "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
       "modelos": [[list(map(float, m[0])), list(map(float, m[1])), list(map(float, m[2])), float(m[3])] for m in ms], "calibracao": CAL.load()}
dest = os.path.join(C.ROOT, "app", "modelo", "modelo.json")
os.makedirs(os.path.dirname(dest), exist_ok=True)
json.dump(out, open(dest, "w", encoding="utf-8"))
print("modelo", out["key"], "->", dest, os.path.getsize(dest), "bytes")
