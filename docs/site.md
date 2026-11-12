# Site (`site/`)

Página estática que roda o núcleo Python no navegador (Pyodide + Pillow, em um Web Worker). Sem servidor: nada de imagem, XML ou valor sai do computador de quem usa.

Abas: **Orçamento**, **Checagem** (XML × pasta; cópias e mover pares só com confirmação dentro da página, em Chrome/Edge), **Montagem** (redimensiona e gera os PDFs A3 de 18 cartas; `pares/` vai para os últimos slots).

## Rodar local (Windows: `powershell -ExecutionPolicy Bypass -File site\build.ps1` e `py -m http.server 8780 -d site`)
## Rodar local (Linux/Mac)
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

## Fluxo por pedido (atualizado)
Escolher a pasta (Drive ou computador) e o XML **uma vez**: a Montagem reaproveita a pasta, o XML e o nome do cliente (que começa com o nome da pasta e pode ser editado).
- **Conferir** relê a pasta sempre; não precisa escolher de novo.
- Pares completos soltos na pasta: a página propõe, sozinha e com confirmação, criar `pares/` e movê-los.
- Par incompleto (por exemplo, não foi subido): **Ignorar este par** (ou "todos"); o par deixa de ser exigido e a escolha fica lembrada naquele navegador para aquele pedido. "Voltar a considerar" desfaz.
- XML dos faltantes sai como `<pasta>_faltantes.xml`.

## Montagem: ordem dos slots e perguntas antes de montar
Ordem: **cartas do XML → (slots em branco) → pares → extras**. Extras são as imagens da pasta que não estão no XML (sem ID no nome ou com ID de outra carta); o verso padrão nunca entra.
- **Extras:** a página lista as imagens e pergunta se vão para os últimos slots, depois dos pares ("Sim, colocar no fim" / "Não incluir"). Enquanto não responder, o botão Montar fica travado.
- **Página incompleta:** se o total não é múltiplo de 18, a página diz quanto falta ("a última página tem 3 de 18 slots: faltam 15") e oferece: adicionar imagens do computador (entram depois dos pares) ou "Montar com N slot(s) em branco" (os brancos ficam antes dos pares).
- Pares ignorados na Checagem não entram na montagem e a página avisa.
- Mudou a lista de extras (pasta alterada): ela pergunta de novo.
