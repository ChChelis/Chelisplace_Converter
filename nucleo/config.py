"""Configuração local (fora do git): caminho da pasta de pedidos e opções por máquina."""
import json
import os
from pathlib import Path

ARQUIVO = Path(__file__).resolve().parent.parent / "config.local.json"
PADRAO_WINDOWS = r"G:\Meu Drive\Novo Processo Proxies"


def pasta_pedidos():
    """Ordem: variável PEDIDOS_DIR, config.local.json, padrão do Windows."""
    env = os.environ.get("PEDIDOS_DIR")
    if env:
        return Path(env)
    if ARQUIVO.exists():
        dados = json.loads(ARQUIVO.read_text(encoding="utf-8"))
        if dados.get("pasta_pedidos"):
            return Path(dados["pasta_pedidos"])
    return Path(PADRAO_WINDOWS)
