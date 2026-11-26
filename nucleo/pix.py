"""Pix copia-e-cola (BR Code estático) e PDF de cobrança com QR. A chave nunca fica no código: vem da página."""
import io
import unicodedata

from PIL import Image, ImageDraw, ImageFont


def _campo(id_, valor):
    return f"{id_}{len(valor):02d}{valor}"


def _crc16(texto):
    crc = 0xFFFF
    for b in texto.encode():
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return f"{crc:04X}"


def _ascii(t, n):
    t = unicodedata.normalize("NFD", t or "").encode("ascii", "ignore").decode()
    return t.strip().upper()[:n] or "NA"


def payload(chave, nome, cidade, valor=None, txid="***"):
    """Texto do Pix copia-e-cola. valor em reais (None = o cliente digita)."""
    chave = (chave or "").strip()
    if not chave:
        raise ValueError("Informe a chave Pix.")
    conta = _campo("00", "br.gov.bcb.pix") + _campo("01", chave)
    corpo = (_campo("00", "01") + _campo("26", conta) + _campo("52", "0000") + _campo("53", "986")
             + (_campo("54", f"{float(valor):.2f}") if valor else "")
             + _campo("58", "BR") + _campo("59", _ascii(nome, 25)) + _campo("60", _ascii(cidade, 15))
             + _campo("62", _campo("05", (txid or "***")[:25])) + "6304")
    return corpo + _crc16(corpo)


def pdf_cobranca(matriz, codigo, cliente, valor, saida=None):
    """PDF A5 com o QR (matriz de 0/1 vinda da página), o valor e o copia-e-cola. Texto selecionável (o copia-e-cola dá para copiar); QR em vetor. Devolve bytes."""
    from . import ficha_pdf, pdf_vetor
    arq_r, arq_b = ficha_pdf._arquivo_fonte(False), ficha_pdf._arquivo_fonte(True)
    if not arq_r or not arq_b:
        raise RuntimeError("fonte Liberation Sans/DejaVu não encontrada para embutir no PDF")
    W, H = 620, 874   # A5 em px a 150 dpi (as medidas do desenho antigo, a 300 dpi, divididas por 2)
    doc = pdf_vetor.Documento(W, H)
    doc.fonte("FRegular", arq_r); doc.fonte("FBold", arq_b)
    pag = doc.nova_pagina()

    def centro(y, txt, tam, chave="FRegular"):   # y = meio da linha, como o anchor "mm" do desenho antigo
        f = doc.fontes[chave]
        doc.texto(pag, chave, (W - f.largura(txt, tam)) / 2, y + tam * 0.34, txt, tam)

    centro(70, "Pagamento via Pix", 32, "FBold")
    centro(120, cliente, 22)
    if valor:
        centro(165, "R$ " + f"{float(valor):.2f}".replace(".", ","), 32, "FBold")
    n, lado = len(matriz), 450
    mod = lado / (n + 8)
    x0, y0 = (W - lado) / 2, 210
    doc.preenchidos(pag, [(x0 + (x + 4) * mod, y0 + (y + 4) * mod, mod, mod) for y, lin in enumerate(matriz) for x, v in enumerate(lin) if v])
    centro(690, "Pix copia e cola", 14)
    for i in range(0, len(codigo), 56):
        centro(720 + 18 * (i // 56), codigo[i:i + 56], 14)
    dados = doc.salvar()
    if saida:
        open(saida, "wb").write(dados)
    return dados
