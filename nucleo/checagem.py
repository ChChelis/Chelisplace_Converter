"""Equivalente à skill /checagem: pasta de imagens × XML, pelo ID do Drive (nunca pelo nome).

`analisar` só lê. Copiar duplicatas e mover pares são funções à parte, chamadas só depois
da confirmação do usuário. Nada é apagado aqui.
"""
import copy
import re
import shutil
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from . import xml_mpc

EXTENSOES = {".jpg", ".jpeg", ".png", ".webp"}
RE_ID = re.compile(r"\(([A-Za-z0-9_-]{20,})\)$")


def id_do_arquivo(caminho):
    m = RE_ID.search(Path(caminho).stem)
    return m.group(1) if m else None


@dataclass
class Resultado:
    exigido: dict = field(default_factory=dict)      # id -> unidades
    nomes: dict = field(default_factory=dict)        # id -> nome no XML
    existentes: dict = field(default_factory=dict)   # id -> [arquivos]
    faltando: dict = field(default_factory=dict)     # id -> quantas faltam e não há nenhuma
    a_duplicar: dict = field(default_factory=dict)   # id -> cópias a criar (existe 1+, faltam cópias)
    excesso: dict = field(default_factory=dict)      # id -> cópias além do exigido
    fora_da_lista: list = field(default_factory=list)
    sem_id: list = field(default_factory=list)
    verso_padrao: list = field(default_factory=list)
    pares: list = field(default_factory=list)        # (id_frente, id_verso)

    @property
    def ok(self):
        return not (self.faltando or self.a_duplicar or self.excesso or self.fora_da_lista or self.sem_id)


def exigido(pedido):
    """Unidades por ID; um ID com vários slots ('3,7,9') exige várias cópias."""
    n, nomes = Counter(), {}
    for c in pedido.frentes + pedido.versos:
        n[c.id] += len(c.slots)
        nomes.setdefault(c.id, c.nome)
    n.pop(pedido.verso_padrao, None)  # verso padrão não entra na contagem
    return dict(n), nomes


def pares(pedido):
    por_slot = {s: c.id for c in pedido.frentes for s in c.slots}
    return [(por_slot[s], v.id) for v in pedido.versos for s in v.slots if s in por_slot]


def analisar(pasta, pedido):
    pasta = Path(pasta)
    r = Resultado()
    r.exigido, r.nomes = exigido(pedido)
    r.pares = pares(pedido)
    for f in sorted(pasta.iterdir()):
        if not f.is_file() or f.suffix.lower() not in EXTENSOES:
            continue
        i = id_do_arquivo(f)
        if i is None:
            r.sem_id.append(f.name)
        elif i == pedido.verso_padrao:
            r.verso_padrao.append(f.name)
        else:
            r.existentes.setdefault(i, []).append(f.name)
    for i, qtd in r.exigido.items():
        tem = len(r.existentes.get(i, []))
        if tem == 0:
            r.faltando[i] = qtd
        elif tem < qtd:
            r.a_duplicar[i] = qtd - tem
        elif tem > qtd:
            r.excesso[i] = tem - qtd
    r.fora_da_lista = sorted(f for i, fs in r.existentes.items() if i not in r.exigido for f in fs)
    return r


def nome_copia(nome_original, n):
    """'<nome sem ID> (copia N) (dup) (<ID>).ext': mantém o ID para a reconferência funcionar."""
    p = Path(nome_original)
    i = id_do_arquivo(p)
    base = RE_ID.sub("", p.stem).rstrip()
    return f"{base} (copia {n}) (dup) ({i}){p.suffix}"


def duplicar(pasta, resultado):
    """Cria as cópias que faltam (não destrutivo). Devolve os arquivos criados."""
    pasta, criados = Path(pasta), []
    for i, extra in resultado.a_duplicar.items():
        origem = resultado.existentes[i][0]
        for n in range(1, extra + 1):
            destino = pasta / nome_copia(origem, n)
            if not destino.exists():
                shutil.copy2(pasta / origem, destino)
                criados.append(destino.name)
    return criados


def separar_pares(pasta, resultado, nome_subpasta="pares"):
    """Move frente e verso de cada par para pares/, só se os dois existirem."""
    pasta, movidos = Path(pasta), []
    destino = pasta / nome_subpasta
    for f, v in resultado.pares:
        if f in resultado.existentes and v in resultado.existentes:
            destino.mkdir(exist_ok=True)
            for i in (f, v):
                nome = resultado.existentes[i][0]
                if (pasta / nome).exists():
                    shutil.move(str(pasta / nome), str(destino / nome))
                    movidos.append(nome)
    return movidos


def xml_dos_faltantes(pedido, resultado, caminho):
    """XML reduzido só com o que falta baixar, com slots renumerados a partir de 0."""
    ids = set(resultado.faltando)
    novo = xml_mpc.Pedido(verso_padrao=pedido.verso_padrao, detalhes=dict(pedido.detalhes))
    mapa, prox = {}, 0
    for c in pedido.frentes:
        if c.id in ids:
            slots = list(range(prox, prox + len(c.slots)))
            for antigo, s in zip(c.slots, slots):
                mapa[antigo] = s
            novo.frentes.append(xml_mpc.Carta(c.id, slots, c.nome, c.query))
            prox += len(slots)
    for c in pedido.versos:
        if c.id in ids:
            slots = []
            for s in c.slots:
                if s not in mapa:
                    mapa[s] = prox
                    prox += 1
                slots.append(mapa[s])
            novo.versos.append(xml_mpc.Carta(c.id, slots, c.nome, c.query))
    novo.detalhes["quantity"] = str(sum(len(c.slots) for c in novo.frentes))
    xml_mpc.escrever(novo, caminho)
    return novo
