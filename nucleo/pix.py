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
    """PDF A5 com o QR (matriz de 0/1 vinda da página), o valor e o copia-e-cola. Devolve bytes."""
    n = len(matriz)
    mod = max(8, 900 // (n + 8))
    lado = (n + 8) * mod
    qr = Image.new("L", (lado, lado), 255)
    d = ImageDraw.Draw(qr)
    for y, linha in enumerate(matriz):
        for x, v in enumerate(linha):
            if v:
                d.rectangle([(x + 4) * mod, (y + 4) * mod, (x + 5) * mod - 1, (y + 5) * mod - 1], fill=0)
    W, H = 1240, 1748  # A5 a 300 dpi... retrato
    pag = Image.new("RGB", (W, H), "white")
    pd = ImageDraw.Draw(pag)
    try:
        f1, f2, f3 = (ImageFont.load_default(size=s) for s in (64, 44, 28))
    except TypeError:
        f1 = f2 = f3 = ImageFont.load_default()
    pd.text((W // 2, 140), "Pagamento via Pix", fill="black", font=f1, anchor="mm")
    pd.text((W // 2, 240), cliente, fill="black", font=f2, anchor="mm")
    if valor:
        pd.text((W // 2, 330), "R$ " + f"{float(valor):.2f}".replace(".", ","), fill="black", font=f1, anchor="mm")
    qr = qr.resize((900, 900), Image.NEAREST).convert("RGB")
    pag.paste(qr, ((W - 900) // 2, 420))
    pd.text((W // 2, 1380), "Pix copia e cola", fill="black", font=f3, anchor="mm")
    for i in range(0, len(codigo), 56):
        pd.text((W // 2, 1440 + 36 * (i // 56)), codigo[i:i + 56], fill="black", font=f3, anchor="mm")
    buf = io.BytesIO()
    pag.save(buf, "PDF", resolution=300, quality=95)
    if saida:
        open(saida, "wb").write(buf.getvalue())
    return buf.getvalue()
