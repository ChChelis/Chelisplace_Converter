"""Leitura do XML do MPC Autofill. O arquivo é dado não confiável: nada é executado."""
import re
from pathlib import Path
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field


@dataclass
class Carta:
    id: str
    slots: list
    nome: str = ""
    query: str = ""


@dataclass
class Pedido:
    frentes: list = field(default_factory=list)
    versos: list = field(default_factory=list)
    verso_padrao: str = ""
    detalhes: dict = field(default_factory=dict)
    extras_padrao: list = field(default_factory=list)  # outros versos padrão (vários pedidos combinados num XML só)


def _cartas(no):
    saida = []
    if no is None:
        return saida
    for c in no.findall("card"):
        slots = [int(s) for s in re.split(r"\s*,\s*", (c.findtext("slots") or "").strip()) if s != ""]
        saida.append(Carta((c.findtext("id") or "").strip(), slots,
                           (c.findtext("name") or "").strip(), (c.findtext("query") or "").strip()))
    return saida


def ler(caminho):
    dados = Path(caminho).read_bytes()
    # ElementTree expande entidades: recusar DTD/entidades evita XML bombs.
    if re.search(rb"<!(DOCTYPE|ENTITY)", dados, re.I):
        raise ValueError("XML com DOCTYPE/ENTITY recusado")
    raiz = ET.fromstring(dados)
    det = {c.tag: (c.text or "").strip() for c in (raiz.find("details") if raiz.find("details") is not None else [])}
    cbs = [(c.text or "").strip() for c in raiz.findall("cardback") if (c.text or "").strip()]
    return Pedido(_cartas(raiz.find("fronts")), _cartas(raiz.find("backs")),
                  cbs[0] if cbs else "", det, cbs[1:])


def versos_padrao(pedido):
    """IDs dos versos 'padrão' (compartilhados), que não contam como slot: o da tag <cardback> e todo verso de <backs> que
    (a) está em 3 ou mais cartas DIFERENTES (um verso de dupla-face é de uma carta só, mesmo com várias cópias) ou
    (b) cobre pelo menos 5 slots e metade do pedido. Ex.: 'Back WUBRG' em quase todos os slots; 'Proxy Playtest Copy' em 14 de 33."""
    ids = ({pedido.verso_padrao} if pedido.verso_padrao else set()) | set(pedido.extras_padrao)
    total = sum(len(c.slots) for c in pedido.frentes)
    por_slot = {s: f.id for f in pedido.frentes for s in f.slots}
    for c in pedido.versos:
        frentes_distintas = {por_slot[s] for s in c.slots if s in por_slot}
        if len(frentes_distintas) >= 3 or len(c.slots) >= max(5, total * 0.5):
            ids.add(c.id)
    return ids


def escrever(pedido, caminho):
    raiz = ET.Element("order")
    det = ET.SubElement(raiz, "details")
    for k, v in pedido.detalhes.items():
        ET.SubElement(det, k).text = v
    for tag, cartas in (("fronts", pedido.frentes), ("backs", pedido.versos)):
        no = ET.SubElement(raiz, tag)
        for c in cartas:
            e = ET.SubElement(no, "card")
            ET.SubElement(e, "id").text = c.id
            ET.SubElement(e, "slots").text = ",".join(str(s) for s in c.slots)
            ET.SubElement(e, "name").text = c.nome
            ET.SubElement(e, "query").text = c.query
    for cb in [pedido.verso_padrao] + list(pedido.extras_padrao):
        ET.SubElement(raiz, "cardback").text = cb
    ET.indent(raiz)
    ET.ElementTree(raiz).write(caminho, encoding="utf-8", xml_declaration=True)
