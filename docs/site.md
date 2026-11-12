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

## Página única (nov/2026): fluxo do pedido do começo ao fim
Visual no estilo da Vitrine de Sets (escuro, acento âmbar). Seis passos em abas: **1 Entrada → 2 Orçamento → 3 Conferência → 4 Imagens (checagem) → 5 Cliente e ficha → 6 Montagem**.
- **Entrada** (`site/pedido.js`): lista colada (`1 Nome (SET) num` ou `2x Nome`), XML do MPCFill, ou `decklist.txt` (modelo “deco”; as imagens entram no passo 4). Dá para somar fontes. O resumo (frentes, versos, slots, páginas) fica no topo.
- **Orçamento**: quantidades vêm da entrada (editáveis). Kits predefinidos e preços **editáveis** (kits de N slots por R$, avulso, colagem, impressão); ficam em `localStorage` (“precos”), com botão para voltar aos de fábrica. Pode digitar o valor combinado com o cliente. Custo/colagem/lucro marcados “só para você”. Cálculo em `nucleo/orcamento.py` (`calcular(..., precos)`: usa o maior kit que cabe, depois o próximo; resto no avulso).
- **Conferência**: procura o **motor local do bot** em `http://127.0.0.1:8781` (`app/server.py`, agora com porta padrão 8781 e CORS só para `localhost:8780`, `pedidos.chelisplace.com` e `*.pages.dev`). Com o bot aberto: link para a conferência e botão “Usar o XML de <pedido>”, que entra como fonte. Sem o bot, segue com XML pronto.
- **Cliente e ficha**: nome, telefone, alterações (título + cartas, com link/ID do Drive do que o cliente pediu e do que foi usado → miniaturas), conclusão. A ficha segue `docs/referencia_processo.md` §5 (`nucleo/ficha.py`) e é **copiada** para o Obsidian; as miniaturas são links `![|110](https://drive.google.com/thumbnail?id=…)`. “Copiar mensagem ao cliente” leva texto + miniaturas.
- **Pix**: chave, nome e cidade ficam só no navegador (nunca no código). Gera o copia-e-cola (BR Code, `nucleo/pix.py`) e um **PDF com QR** (matriz do QR vem de `site/qrcode.min.js`, qrcode-generator 1.4.4, MIT).
Endereço publicado: https://chelisplace-converter-pedidos.shrill-mountain-e326.workers.dev (Cloudflare Workers com arquivos estáticos, `wrangler.jsonc`; o domínio próprio exigiria mover o DNS ou usar Pages com CNAME).
Pendente nesta etapa: testar o motor local com o Windows real; miniaturas escolhidas direto dos candidatos do bot (hoje por link/ID do Drive); Archidekt.

### Miniaturas vindas do bot (passo 3)
Com o bot aberto, “Cartas sem versão próxima de <pedido>” lê `/api/pedidos/<n>/catalogo` e `/decisoes` e lista as cartas com decisão “nenhum” ou aceitas com confiança “nenhum” (versos ignorados). Cada uma leva **miniatura do pedido** (imagem pequena do Scryfall por `set/número`; Liga sem edição fica sem) e **do usado** (miniatura do Drive pelo ID escolhido). “Levar para a ficha” cria a alteração “Cartas sem versão próxima” no passo 5, onde dá para editar. Na ficha, as miniaturas são links `![|110](url)`; os itens aceitam `pedido_img`/`usado_img` (URL) ou `pedido_id`/`usado_id` (Drive). Se o Obsidian não exibir esses links, o plano B é salvar as imagens como anexos no cofre.

### PDF da ficha (substitui as miniaturas no texto)
O texto copiado para o Obsidian é só texto (sem links de imagem). As miniaturas aparecem na **prévia da página** e no **PDF da ficha para o cliente** (`nucleo/ficha_pdf.py`: pedido, alterações com miniaturas, valor, QR do Pix; nada confidencial). A página baixa cada miniatura (direto, ou pelo Drive logado, ou pelo cache do bot) e avisa quantas não vieram.
