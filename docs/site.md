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

### Imagens do XML para o Drive (etapa 4)
Com o XML carregado e o login do Google feito, “Enviar as imagens para o Drive” cria (ou reaproveita) `Novo Processo Proxies/<pedido>` e copia cada imagem distinta do XML (frentes e versos) pelo próprio Drive (`files.copy`), com o nome `<carta> (<ID>).<ext>` que a checagem usa. Pula as que já estão lá, roda 4 cópias em paralelo, pede confirmação na página e não apaga nada. Ao terminar, a etapa 4 já abre nessa pasta. Falhas (por exemplo, arquivo sem permissão de cópia) são listadas; essas vão pelo bot. Testado com Drive simulado; **ainda não no Drive real**.

### Orçamento: como funciona (atualizado)
Cada linha da tabela é um **kit** (N slots por R$ X). O pedido usa o maior kit que couber, depois o seguinte; o que sobrar vai como **avulso** (R$/slot). Opção “calcular pelo menor kit”: avulso = preço ÷ slots do menor kit (18 por R$ 30 → R$ 1,6667). A conta aparece linha a linha, e o **valor cobrado** começa igual ao calculado (só mude se combinou outro; “Usar o calculado” volta). Cada etapa tem **← Voltar** e **Próximo →**.

### PDF da ficha = a própria ficha (formato do Chelis)
O PDF para o cliente é o texto da ficha (o da caixa de edição, editado ou não) desenhado em A4 no modelo do `Pedido_Gui_Torneio_Hashaton.pdf`: títulos em negrito, listas com número cinza, fonte Liberation Sans (`nucleo/fontes/`, copiada por `site/build.sh`/`build.ps1`). Fica de fora tudo de `#### Confidencial` e a linha “Valor do pedido”; o **QR do Pix** vai ao fim, depois da chave. Miniaturas (se houver) aparecem sob o item da alteração. Botões: **Baixar tudo** (`Pedido <Cliente>.md` + `Pedido <Cliente>.pdf`), **Só o .md**, **Só o PDF do cliente**.

### Fluxo não linear (nov/2026)
O bot (etapa 3) só é necessário quando a entrada foi **lista**. Com XML (do MPCFill ou do bot) ou imagens + decklist, a aba 3 aparece como “(não precisa)”, a página avisa e **Voltar/Próximo pulam a etapa**. “Usar o XML do bot” substitui a lista que o originou (uma fonte só).

### Verso padrão repetido no XML
XMLs como o do iggor listam, em `<backs>`, um mesmo verso (ex.: “Back WUBRG”) em quase todos os slots. Isso é o **verso padrão** (sai da pasta no processo do Chelis) e **não conta como slot** nem entra na ficha. Regra, igual no núcleo (`xml_mpc.versos_padrao`) e na página: é padrão o ID da tag `<cardback>` e qualquer verso de `<backs>` que cubra pelo menos 5 slots **e** metade das frentes. Dupla-face (um verso por frente) continua contando +1. Afeta o orçamento (versos), a checagem (não exige cópias), os pares e a montagem. Exemplo: 191 frentes + 4 versos = 195 slots (não 381).

### Divisão automática do orçamento (kits)
Prioridade: o maior kit que couber (quantos couberem), depois o próximo maior, e assim por diante. O que sobrar (menos que o menor kit) vira um **kit final separado do menor tamanho** (opção “o que sobrar vira um kit do menor tamanho”, ligada por padrão para quem tem kit de até 18 slots), cobrado pelo preço desse kit; sem a opção, é cobrado por slot avulso (`nucleo/orcamento.py`, campo `kit_final`). Exemplo com kits 108/R$135, 72/R$120 e 18/R$30 e 194 slots: 1 × 108 + 1 × 72 + 1 kit final de 18 (sobraram 14) = R$ 285, 11 páginas.

### Etapas com bloqueio, descontos, Novo pedido (nov/2026)
- **Não passa com pendência:** o **Próximo** fica desabilitado e diz o que falta; clicar numa aba à frente também é barrado com um aviso (voltar é livre). Pendências: 1 traga o pedido; 2 slots > 0 e valor cobrado; 3 (só para lista) usar o XML do bot; 4 pasta escolhida, cópia do Drive terminada e **Conferir** feito sem pendências (faltando, a duplicar, a mais, pares incompletos ou soltos; a conferência vale até a pasta mudar); 5 nome do cliente.
- **Descontos (confidencial, etapa 2):** “todos os slots a R$ X” (padrão: o menor preço por slot da tabela, ex.: 1,25) e “ceder N% do lucro” (padrão 10%); mostra preço, desconto e lucro que sobra (avisa prejuízo) e **Aplicar** leva o valor ao campo cobrado.
- **Botões sem uso ficam desabilitados** (ex.: enviar imagens para o Drive quando a pasta já tem tudo; Entrar com Google quando conectado; Usar o XML do bot depois de carregado; Usar o calculado sem edição).
- **Novo pedido** (fim da montagem): zera pedido, ficha, pasta, XML e perguntas, mantendo o Google Drive conectado e as configurações.

### Correção de sangria (botão separado, etapa 4)
Baseada em `HANDOFF_SANGRIA.md`/`bleed.py` (zip do Chelis); lógica em `nucleo/sangria.py`. Botão **Corrigir sangria…** (fora do Conferir): lista as imagens da pasta **sem ID de 20+ caracteres** (as com ID são do MPCFill; há caixa para mostrar todas) e aceita imagens do computador. Modo por imagem: **borda estendida** (padrão), **branco** ou **preto**. Saída: PNG RGBA 816×1110, carta 744×1040 centralizada, 299,9994 dpi; transparência interna preservada. Mostra **antes/depois com zoom dos cantos**; mudar o modo refaz a imagem. Depois **pergunta** se quer inserir as corrigidas no pedido: **sim** (a original vai para `originais_sem_sangria/`, nada é apagado, a corrigida ocupa o lugar; as do computador entram como novas; vale para pasta do computador com gravação e para o Drive), **só baixar (zip)** ou **descartar**. Enquanto a pergunta não é respondida, o Próximo fica bloqueado; inserir zera a conferência. numpy e scipy (~30 MB) só são baixados na primeira vez que o recurso é usado (Pyodide).

### Raciocínio do preço no .md e valor no PDF
O `.md` (Obsidian) agora traz, dentro de `#### Confidencial`, o raciocínio do preço: divisão em kits (ex.: 1 × kit de 108 slots (6 pág.) = 135; 1 × kit de 72…; kit final de 18 (sobraram 14) = 30), valor da tabela, valor cobrado (com o desconto/acréscimo sobre a tabela, se editado) e os **descontos possíveis** (todos os slots ao preço por slot e % do lucro cedido, com o lucro que sobra), antes do custo. Quem gera é `nucleo/ficha.py` (`raciocinio`); os parâmetros dos descontos vêm dos campos da etapa 2. O **PDF do cliente** passa a mostrar a linha “Valor do pedido: N reais” (antes ficava só no QR) e continua sem nada do bloco confidencial.

### Desconto sobre o pedido e vários pedidos no mesmo pedido
- **Desconto em %:** é sobre o **valor do pedido** (tabela), não sobre o lucro (o cliente nunca pode ver o lucro). Ex.: 10% de R$ 285 = R$ 29 → R$ 256. A outra opção continua: todos os slots a um preço por slot (ex.: R$ 1,25).
- **Mais de um pedido no mesmo pedido** (mesmo cliente): na Entrada, repita a entrada quantas vezes precisar (lista, XML, decklist). Os slots são somados (kits incompletos se completam: 172 + 194 slots → R$ 255 + R$ 285 = 540 separados; juntos, 366 slots = R$ 495) e o Orçamento mostra **juntos × separados** com a economia (também no `.md`, no bloco confidencial). A checagem e a montagem leem **um XML combinado** dos pedidos (slots em sequência, versos padrão de cada pedido tratados à parte); a cópia para o Drive leva as imagens de todos para a mesma pasta; a ficha lista cada pedido numa seção (`#### 1. …`, `#### 2. …`).
