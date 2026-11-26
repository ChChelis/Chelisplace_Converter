"""Escritor mínimo de PDF com TEXTO de verdade (selecionável, copiável, pesquisável), sem dependências além do Pillow.

Os PDFs da ficha e do Pix eram páginas desenhadas como imagem (texto não selecionável). Aqui o texto vira texto do PDF, com a fonte
(TrueType, ex.: Liberation Sans) embutida como Type0/Identity-H e um ToUnicode, de modo que acentos, "→" e "•" copiam certo.
Imagens (miniaturas) entram como JPEG; o QR é desenhado como retângulos (vetor, nítido e legível).
Coordenadas de entrada em px a 150 dpi (y para baixo), como o desenho da ficha usava; a página sai em pontos (A4 = 595,2 x 841,92).
"""
import io
import struct
import zlib

PT = 72 / 150  # pontos por px (150 dpi)


class FonteTTF:
    """Lê só o que o PDF precisa de uma fonte TrueType: cmap (unicode -> glifo), larguras, métricas e caixa."""

    def __init__(self, caminho):
        self.dados = open(caminho, "rb").read()
        d = self.dados
        n = struct.unpack(">H", d[4:6])[0]
        self.tab = {}
        for i in range(n):
            tag, _, off, ln = struct.unpack(">4sIII", d[12 + 16 * i: 28 + 16 * i])
            self.tab[tag.decode("latin-1")] = (off, ln)
        h = self.tab["head"][0]
        self.upem = struct.unpack(">H", d[h + 18: h + 20])[0]
        self.bbox = struct.unpack(">4h", d[h + 36: h + 44])
        a = self.tab["hhea"][0]
        self.ascent, self.descent = struct.unpack(">2h", d[a + 4: a + 8])
        self.n_metricas = struct.unpack(">H", d[a + 34: a + 36])[0]
        self.cmap = self._ler_cmap()
        self.usados = {}  # glifo -> caractere (para o ToUnicode)

    def _ler_cmap(self):
        d = self.dados
        off = self.tab["cmap"][0]
        n = struct.unpack(">H", d[off + 2: off + 4])[0]
        subs = []
        for i in range(n):
            plat, enc, so = struct.unpack(">HHI", d[off + 4 + 8 * i: off + 12 + 8 * i])
            subs.append((plat, enc, off + so))
        # preferência: Unicode completo (formato 12), senão BMP (formato 4)
        for plat, enc, o in sorted(subs, key=lambda s: (s[0], s[1]), reverse=True):
            fmt = struct.unpack(">H", d[o: o + 2])[0]
            if fmt == 12 and (plat, enc) in ((3, 10), (0, 4), (0, 6)):
                return self._cmap12(o)
        for plat, enc, o in subs:
            if struct.unpack(">H", d[o: o + 2])[0] == 4 and (plat, enc) in ((3, 1), (0, 3), (0, 4), (0, 1), (0, 0)):
                return self._cmap4(o)
        raise ValueError("fonte sem cmap Unicode utilizável")

    def _cmap4(self, o):
        d, m = self.dados, {}
        seg = struct.unpack(">H", d[o + 6: o + 8])[0] // 2
        fins = struct.unpack(f">{seg}H", d[o + 14: o + 14 + 2 * seg])
        ini0 = o + 16 + 2 * seg
        inis = struct.unpack(f">{seg}H", d[ini0: ini0 + 2 * seg])
        dl0 = ini0 + 2 * seg
        deltas = struct.unpack(f">{seg}h", d[dl0: dl0 + 2 * seg])
        ro0 = dl0 + 2 * seg
        ros = struct.unpack(f">{seg}H", d[ro0: ro0 + 2 * seg])
        for i in range(seg):
            for c in range(inis[i], fins[i] + 1):
                if c == 0xFFFF:
                    continue
                if ros[i] == 0:
                    g = (c + deltas[i]) & 0xFFFF
                else:
                    p = ro0 + 2 * i + ros[i] + 2 * (c - inis[i])
                    g = struct.unpack(">H", d[p: p + 2])[0]
                    if g:
                        g = (g + deltas[i]) & 0xFFFF
                if g:
                    m[c] = g
        return m

    def _cmap12(self, o):
        d, m = self.dados, {}
        n = struct.unpack(">I", d[o + 12: o + 16])[0]
        for i in range(n):
            ini, fim, g0 = struct.unpack(">III", d[o + 16 + 12 * i: o + 28 + 12 * i])
            for c in range(ini, fim + 1):
                m[c] = g0 + (c - ini)
        return m

    def largura_glifo(self, g):
        off = self.tab["hmtx"][0]
        i = min(g, self.n_metricas - 1)
        return struct.unpack(">H", self.dados[off + 4 * i: off + 4 * i + 2])[0]

    def glifos(self, texto):
        """Lista de glifos do texto (caractere ausente na fonte vira '?'). Marca-os como usados."""
        saida = []
        for ch in texto:
            g = self.cmap.get(ord(ch)) or self.cmap.get(ord("?"), 0)
            self.usados[g] = ch if self.cmap.get(ord(ch)) else "?"
            saida.append(g)
        return saida

    def largura(self, texto, tam):
        """Largura do texto em unidades do tamanho `tam` (mesma unidade de `tam`)."""
        return sum(self.largura_glifo(self.cmap.get(ord(c)) or self.cmap.get(ord("?"), 0)) for c in texto) * tam / self.upem


def _nome(n):
    return f"/{n}"


class Documento:
    def __init__(self, largura_px, altura_px):
        self.w, self.h = largura_px * PT, altura_px * PT
        self.paginas = []   # cada uma: {"ops": [bytes], "imgs": [(nome, jpeg, w, h)]}
        self.fontes = {}    # chave -> FonteTTF
        self._n_img = 0

    def fonte(self, chave, caminho):
        if chave not in self.fontes:
            self.fontes[chave] = FonteTTF(caminho)
        return self.fontes[chave]

    def nova_pagina(self):
        self.paginas.append({"ops": [], "imgs": []})
        return len(self.paginas) - 1

    def _pg(self, i):
        return self.paginas[i]

    def texto(self, pag, chave, x_px, base_px, texto, tam_px, cinza=0.0):
        """Texto com a linha de base em base_px (px, y para baixo) e tamanho tam_px (px = altura do em)."""
        if not texto:
            return
        f = self.fontes[chave]
        hexa = "".join(f"{g:04X}" for g in f.glifos(texto))
        x, y = x_px * PT, self.h - base_px * PT
        self._pg(pag)["ops"].append(f"BT {cinza:.3f} g /{chave} {tam_px * PT:.3f} Tf {x:.2f} {y:.2f} Td <{hexa}> Tj ET".encode())

    def retangulo(self, pag, x0, y0, x1, y1, cinza=0.69, espessura_px=1):
        x, y, w, h = x0 * PT, self.h - y1 * PT, (x1 - x0) * PT, (y1 - y0) * PT
        self._pg(pag)["ops"].append(f"q {cinza:.3f} G {espessura_px * PT:.3f} w {x:.2f} {y:.2f} {w:.2f} {h:.2f} re S Q".encode())

    def preenchidos(self, pag, retangulos, cinza=0.0):
        """Vários retângulos cheios (x, y, w, h em px) numa operação só: usado no QR."""
        partes = [f"{x * PT:.3f} {self.h - (y + h) * PT:.3f} {w * PT:.3f} {h * PT:.3f} re" for x, y, w, h in retangulos]
        self._pg(pag)["ops"].append(f"q {cinza:.3f} g {' '.join(partes)} f Q".encode())

    def imagem(self, pag, im, x_px, y_px):
        im = im.convert("RGB")
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=92, subsampling=0)
        self._n_img += 1
        nome = f"Im{self._n_img}"
        self._pg(pag)["imgs"].append((nome, buf.getvalue(), im.width, im.height))
        w, h = im.width * PT, im.height * PT
        self._pg(pag)["ops"].append(f"q {w:.3f} 0 0 {h:.3f} {x_px * PT:.3f} {self.h - (y_px + im.height) * PT:.3f} cm /{nome} Do Q".encode())

    # ------------------------------------------------------------ saída
    def salvar(self):
        objs = []   # objs[i] = bytes do objeto i+1

        def novo(corpo=b""):
            objs.append(corpo)
            return len(objs)

        def definir(i, corpo):
            objs[i - 1] = corpo

        def fluxo(dic, dados, comprimir=True):
            if comprimir:
                dados = zlib.compress(dados, 9)
                dic += " /Filter /FlateDecode"
            return f"<< {dic} /Length {len(dados)} >>\nstream\n".encode() + dados + b"\nendstream"

        catalogo, paginas_raiz = novo(), novo()
        refs_fonte = {}
        for chave, f in self.fontes.items():
            ttf = novo(fluxo(f"/Length1 {len(f.dados)}", f.dados))
            esc = 1000 / f.upem
            desc = novo((f"<< /Type /FontDescriptor /FontName /{chave}X /Flags 32 /FontBBox [{' '.join(str(round(v * esc)) for v in f.bbox)}] "
                         f"/ItalicAngle 0 /Ascent {round(f.ascent * esc)} /Descent {round(f.descent * esc)} /CapHeight {round(f.ascent * esc)} /StemV 80 /FontFile2 {ttf} 0 R >>").encode())
            usados = sorted(f.usados)
            larg = " ".join(f"{g} [{round(f.largura_glifo(g) * esc)}]" for g in usados)
            cid = novo((f"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{chave}X /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
                        f"/FontDescriptor {desc} 0 R /CIDToGIDMap /Identity /DW 1000 /W [{larg}] >>").encode())
            linhas = ["/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def",
                      "1 begincodespacerange <0000> <FFFF> endcodespacerange"]
            for i in range(0, len(usados), 100):
                bloco = usados[i:i + 100]
                linhas.append(f"{len(bloco)} beginbfchar")
                for g in bloco:
                    u = f.usados[g].encode("utf-16-be").hex().upper()
                    linhas.append(f"<{g:04X}> <{u}>")
                linhas.append("endbfchar")
            linhas.append("endcmap CMapName currentdict /CMap defineresource pop end end")
            tou = novo(fluxo("", "\n".join(linhas).encode()))
            refs_fonte[chave] = novo((f"<< /Type /Font /Subtype /Type0 /BaseFont /{chave}X /Encoding /Identity-H /DescendantFonts [{cid} 0 R] /ToUnicode {tou} 0 R >>").encode())
        kids = []
        for pg in self.paginas:
            conteudo = novo(fluxo("", b"\n".join(pg["ops"])))
            xobj = ""
            for nome, jpeg, w, h in pg["imgs"]:
                im = novo(f"<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpeg)} >>\nstream\n".encode() + jpeg + b"\nendstream")
                xobj += f"/{nome} {im} 0 R "
            fontes = " ".join(f"/{c} {r} 0 R" for c, r in refs_fonte.items())
            kids.append(novo((f"<< /Type /Page /Parent {paginas_raiz} 0 R /MediaBox [0 0 {self.w:.2f} {self.h:.2f}] /Contents {conteudo} 0 R "
                              f"/Resources << /Font << {fontes} >> /XObject << {xobj}>> >> >>").encode()))
        definir(paginas_raiz, f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode())
        definir(catalogo, f"<< /Type /Catalog /Pages {paginas_raiz} 0 R >>".encode())
        saida = bytearray(b"%PDF-1.5\n%\xe2\xe3\xcf\xd3\n")
        offs = []
        for i, o in enumerate(objs, 1):
            offs.append(len(saida))
            saida += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
        xref = len(saida)
        saida += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
        for o in offs:
            saida += f"{o:010d} 00000 n \n".encode()
        saida += f"trailer\n<< /Size {len(objs) + 1} /Root {catalogo} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        return bytes(saida)
