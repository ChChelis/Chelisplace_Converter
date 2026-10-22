"""Orçamento do pedido (fórmulas da skill /clientrundown). Preços ficam em TABELAS, fáceis de mudar."""
import math
from decimal import ROUND_HALF_UP, Decimal

TABELAS = {
    "normal": dict(kit_slots=108, kit_preco=135.0, avulso=1.6667, kit_pag=6),
    "foil": dict(kit_slots=180, kit_preco=330.0, avulso=2.44441, kit_pag=10),
}
IMPRESSAO_PAGINA = 14.0      # normal: R$ por página
FOIL_KIT_IMPRESSAO = 121.99  # foil: por kit de 10 páginas
FOIL_PAGINA_EXTRA = 24.99
COLAGEM_SLOT = 0.13
SLOTS_POR_PAGINA = 18


def inteiro(x):
    """Arredonda para o inteiro mais próximo (meio sobe). Regra assumida; ver docs/nucleo.md."""
    return int(Decimal(str(x)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def calcular(frentes, versos=0, modo="normal"):
    """frentes/versos = unidades; cada verso distinto conta +1 slot."""
    t = TABELAS[modo]
    slots = frentes + versos
    paginas = math.ceil(slots / SLOTS_POR_PAGINA)
    kits, resto = divmod(slots, t["kit_slots"])
    pago = inteiro(kits * t["kit_preco"] + resto * t["avulso"])
    if modo == "normal":
        impressao = paginas * IMPRESSAO_PAGINA
    else:
        impressao = kits * FOIL_KIT_IMPRESSAO + (paginas - kits * t["kit_pag"]) * FOIL_PAGINA_EXTRA
    colagem = inteiro(slots * COLAGEM_SLOT)
    return dict(slots=slots, paginas=paginas, kits=kits, resto=resto, pago=pago,
                impressao=round(impressao, 2), colagem=colagem,
                lucro=round(pago - impressao - colagem, 2))
