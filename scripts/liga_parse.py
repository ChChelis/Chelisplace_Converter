"""Lê o HTML salvo de um deck da LigaMagic (visão padrão) e escreve a lista `qtd Nome` em inglês.

Uso: python3 -I scripts/liga_parse.py deck.html saida.txt
Trata o HTML só como dado (regex), nada é executado. Edição/versão: o HTML salvo costuma não trazer
(data-lc-ed e deck-edi vazios); se algum dia vier preenchido, vai junto como `(EDIÇÃO)`.
"""
import html, re, sys, urllib.parse

s = open(sys.argv[1], encoding="utf-8", errors="replace").read()
blk = re.search(r'id="dk-val-1-\d+".*?(?=id="dk-val-2-)', s, re.S).group(0)
out, secs, cur = [], [], None
for m in re.finditer(r'<div class="deck-type[^"]*">([^<]+)<i>\((\d+)\)</i>|<div class="deck-qty">(\d+)[^<]*</div><div class="deck-card">(.*?)</div><div class="deck-edi">(.*?)</div>', blk, re.S):
    if m.group(1):
        cur = m.group(1).strip(); secs.append((cur, int(m.group(2)))); continue
    link = re.search(r'card=([^"&]+(?:&amp;[^"]*)?)"', m.group(4))
    name = urllib.parse.unquote_plus(html.unescape(link.group(1))) if link else re.sub(r"<[^>]+>", "", m.group(4)).strip()
    edi = re.sub(r"<[^>]+>", "", m.group(5)).strip()
    out.append((int(m.group(3)), name, edi, cur))
open(sys.argv[2], "w", encoding="utf-8").write("".join(f"{q} {n}" + (f" ({e})" if e else "") + "\n" for q, n, e, _ in out))
print(f"{len(out)} linhas, {sum(q for q, *_ in out)} cartas | seções: {secs} | com edição: {sum(1 for *_, e, _ in out if e)}")
