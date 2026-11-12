# Site (`site/`)

Página estática que roda o núcleo Python no navegador (Pyodide + Pillow, em um Web Worker). Sem servidor: nada de imagem, XML ou valor sai do computador de quem usa.

Abas: **Orçamento**, **Checagem** (XML × pasta; cópias e mover pares só com confirmação dentro da página, em Chrome/Edge), **Montagem** (redimensiona e gera os PDFs A3 de 18 cartas; `pares/` vai para os últimos slots).

## Rodar local
```
sh site/build.sh              # copia nucleo/ para site/nucleo (gitignored)
python3 -m http.server 8780 -d site
```
Abrir http://localhost:8780. A 1ª abertura baixa o Pyodide (~10 MB, depois fica em cache).

## Publicar (Cloudflare Pages, grátis)
- Build command: `sh site/build.sh` · Output directory: `site`
- Domínio: subdomínio `pedidos.chelisplace.com` (CNAME no painel do Squarespace Domains, onde o DNS está). Não mexe nos registros de e-mail.

## Testado
Chromium headless (Playwright) com Pyodide 0.27.7: orçamento, checagem com XML + 20 imagens (acusa as 2 cópias que faltam) e montagem de 2 PDFs A3. Fallback sem `showDirectoryPicker` (Firefox/Safari): lê a pasta, mas não grava; PDFs saem como links de download.

## Ainda não existe
Login Google/Drive, intermediário do MPCFill (o MPCFill não aceita chamadas de outro site), conferência de cartas, ajustador de imagem, pasta `completar/`, validação visual contra o Photoshop.
