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
XMLs como o do iggor listam, em `<backs>`, um mesmo verso (ex.: “Back WUBRG”) em quase todos os slots. Isso é o **verso padrão** (sai da pasta no processo do Chelis) e **não conta como slot** nem entra na ficha. Regra, igual no núcleo (`xml_mpc.versos_padrao`) e na página: é padrão o ID da tag `<cardback>` e qualquer verso de `<backs>` que esteja em **3 ou mais cartas diferentes** (um verso de dupla-face é de uma carta só, mesmo com várias cópias) ou que cubra pelo menos 5 slots **e** metade das frentes. Ex.: “Proxy Playtest Copy” em 14 de 33 slots (Cube LLJR) é padrão. Dupla-face (um verso por frente) continua contando +1. Afeta o orçamento (versos), a checagem (não exige cópias), os pares e a montagem. Exemplo: 191 frentes + 4 versos = 195 slots (não 381).

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

### Progresso e entradas repetidas
Criar cópias, mover pares e copiar imagens para o Drive mostram **andamento** (“Criando cópia 3 de 10…”, barra e contagem de copiadas/já existentes). Depois que já há um pedido, as entradas da etapa 1 passam a se chamar “Adicionar outra lista / outro XML / outra decklist” e um aviso diz que usar de novo **adiciona** outro pedido (não substitui); o campo do arquivo é limpo após ler.

### Tabela de preços × divisão do pedido
O painel “Tabela de preços” (kits e preços) é preenchido **uma vez** e vale para todos os pedidos; o pedido é dividido sozinho (maior kit primeiro, depois os menores, o resto vira kit final do menor tamanho). A coluna **Neste pedido** mostra quantos de cada kit foram usados (ex.: 44 slots → kit de 18: 2 × = R$ 60 + 1 kit final (sobraram 8) = R$ 30 → R$ 90; kits de 108 e 72: não usados).

### Sangria: três opções com miniatura, envio ao Drive; extras e `completar/` na conferência
- **Sangria:** para cada imagem a página gera **borda, branco e preto** de uma vez e mostra a miniatura de cada uma (com zoom nos cantos) ao lado da original; o clique escolhe o modo. Só então vem a pergunta: **inserir no pedido** (original vai para `originais_sem_sangria/`), **enviar para uma pasta do Drive** (escolhe o pedido; entram como arquivos novos, sem tocar nas originais) ou **baixar zip**.
- **Extras na Conferência:** a pasta `completar/` (e subpastas até 3 níveis) e as imagens soltas sem ID/fora do XML passam a ser lidas e listadas como **extras**. Como mudam o total depois do orçamento, a conferência pergunta: **incluir e atualizar o valor**, **incluir e manter o valor** (congela o valor combinado) ou **não incluir**, mostrando slots e valor antes/depois. Incluir cria a seção “Cartas para completar” (orçamento, ficha e montagem a usam) e a montagem não pergunta de novo. Enquanto não houver decisão, o Próximo da etapa 4 fica bloqueado. Desfazer/Mudar sempre disponíveis.

### Imagens que sumiram do MPCFill: “Usar no lugar”
- O Drive responde **404** quando uma imagem do XML foi apagada ou ficou privada no MPCFill; o bot também não consegue baixá-la. A cópia para o Drive agora lista **todas** as falhas com um motivo curto (não existe mais / limite do Drive / sem permissão) e orienta o que fazer.
- Quando você sobe à mão outra versão (arquivo com outro ID), a Conferência mostra **Usar no lugar**: para cada imagem faltando, escolhe-se qual imagem extra entra (sugestão automática pelo nome da carta). A troca vale no XML combinado (`sessao.trocas`), faz o “faltando” e o “extra” sumirem e deixa só o “a duplicar” (cópias que faltam). Cada troca vira um item em **Alterações → Artes trocadas (original indisponível)** na ficha, com a miniatura da imagem usada. Dá para **desfazer** cada troca. Se há faltando, o aviso de extras lembra de usar “Usar no lugar” em vez de incluir (para não contar em dobro).
- Nomes de arquivo com o sufixo do navegador (`… (ID) (1).jpg`) agora têm o ID reconhecido (antes caíam em “sem ID”).

### ID no nome do arquivo com marcas de cópia
O ID (20+ caracteres entre parênteses) é reconhecido mesmo com o que o navegador/Windows acrescenta a cópias: ` (1)`, ` - Copia`, ` - Copia (2)`, ` - Copy` (`nucleo/checagem.py` `RE_ID` e `RE_ID_ARQ` em `site/pedido.js`). **Cópias a mais** do mesmo ID podem ser movidas, com confirmação e progresso, para a subpasta `copias_a_mais/` (nada é apagado; fica o arquivo de nome mais curto de cada imagem).

### “Usar no lugar” também com cópias a mais
Uma imagem **sobrando** (cópia a mais de um ID que o XML já pede) pode ser a substituta de uma que sumiu do MPCFill (ex.: a mesma arte subida à mão, já pedida por outra linha). O quadro **Usar no lugar** agora oferece essas sobras (“— cópia a mais”) além das imagens fora do XML; ao trocar, o ID da imagem que sumiu passa a ser o dela, e “faltando” e “a mais” somem juntos. Não use “Mover cópia a mais” nesse caso.

### Versão da página e PDFs anteriores
- O cabeçalho mostra **“· versão <commit>”** (`site/versao.json`, gerado pelo `build.sh`/`build.ps1`, não vai para o git) e, a cada 5 minutos, a página confere se saiu uma versão nova; se sim, avisa no topo que a aba ainda roda a antiga e que **recarregar zera o pedido** (terminar/anotar antes). Aba aberta antes de uma correção continua com o Python antigo na memória, por isso o aviso.
- **PDFs na pasta `saida` do Drive:** ao salvar, PDFs com o mesmo nome de uma montagem anterior vão para `saida/anteriores` (nada é apagado), e a saída fica só com a montagem atual.

### Colagem pela página inteira
O custo de colagem (confidencial, no orçamento e no `.md`) agora é `páginas × 18 adesivos × R$ 0,13` (`nucleo/orcamento.py`), e não `slots × 0,13`: os adesivos que completam a última página também são colados, às custas do pedido. Ex.: 194 slots = 11 páginas = 198 adesivos → R$ 26 (antes R$ 25) e lucro R$ 105 (antes R$ 106). O `.md` mostra “Colagem: 11 páginas x 18 adesivos x0,13 = 26”.

## Listas coladas (Moxfield, Archidekt) e impressão adivinhada (nov/2026)
`site/lista.js` (`lerLista`, `marcarFicha`; testes: `node --test site/test/*.test.mjs`) lê o texto exportado: `1 Nome (SET) num`, `1x Nome (set) num [Categoria] ^Tag^`, `*F*`. Guarda `set`/`numero` por carta; sem eles a carta é **adivinhada** (o bot usa a primeira edição em papel, a mais antiga, via `scripts/deck_parse.py`). A página não consulta o Scryfall nem baixa imagem: a escolha da arte continua no bot/MPCFill. Na ficha (e no PDF do cliente) a fonte ganha uma nota; o `*` por carta só aparece quando a lista mistura cartas com e sem set. O bot (`deck_parse.parse_line`) também ignora `[Categoria]` e `^Tag^`. LigaMagic (HTML salvo) e nomes em português: **ainda não feito** (falta exemplo real).
**Enviar ao bot (passo 3):** com o bot conectado, cada lista do passo 1 (origem `lista`; decklist com imagens não vai) ganha “Enviar ao bot”: `POST http://127.0.0.1:8781/api/pedidos {nome, lista}`, com a lista em `qtd Nome (SET) num` (cópias iguais agrupadas). O nome sugerido vem do campo do cliente (sem acento, só `A-Za-z0-9_-`) e pode ser editado; nome repetido o bot recusa e a página mostra o erro. O bot já começa a processar. Depois, “Usar o XML de …” troca a lista pelo XML (mesmo tamanho).

## Pendentes do bot, alterações do bot e sangria na Montagem (nov/2026)
- **“Nenhum serve” não some mais do pedido.** O XML do bot (`scripts/export_order.py`) leva essas cartas em `<pendentes><card><slots>..</slots><name>..</name><set>..</set><number>..</number></card></pendentes>` (slots depois dos que têm imagem; `<fronts>`/`<quantity>` seguem sem buracos). A página lê (`lerXmlMpc`) e as conta como frentes com `pendente: true`: **orçamento e ficha incluem**; não têm `id`, então nada tenta copiar/checar imagem delas. Dúvidas/não decididas continuam “fora”.
- **Etapa 4 e 6:** avisam “N de M slots esperam imagem”. Imagens extras na pasta (ou `completar/`) **preenchem os pendentes sem mudar o valor** (só o que passar do número de pendentes pergunta “incluir e atualizar o valor”). Na Montagem, enquanto faltam imagens, o botão fica travado (“Montar sem elas” libera); há **Corrigir sangria…** ali (o painel de sangria muda de lugar, `#m-sg-host`) e, ao inserir, o plano atualiza sozinho.
- **Alterações do bot na ficha:** “Usar o XML de …” já traz para a etapa 5 as cartas marcadas/anotadas no bot (grupos “Imagens de outra fonte (sem versão no MPCFill)” e “Artes alteradas”); o botão **Trazer alterações do bot** (etapa 5) refaz só esses grupos. Mesma regra da tela do bot (`msg` explícito; sem marca: sem versão próxima ou com anotação).
- **Imagens pendentes, o vai e vem:** a Montagem relê a pasta ao abrir (Drive/computador) e as etapas 4 e 6 têm **Reler a pasta**; **Corrigir sangria…** também relê a pasta ao abrir e passa a listar o que está em `completar/` (a corrigida fica ao lado da original, e a original vai para `originais_sem_sangria/`). O PDF do cliente quebra linha nos itens compridos.
- **Pendentes × imagens da pasta (etapas 4 e 6):** as cartas pendentes do bot são agrupadas (“Mountain ×9”). Cada grupo mostra quantos slots já têm imagem e quais imagens o cobrem. O casamento é automático pelo nome da carta no nome do arquivo (1 cópia por imagem); você pode **escolher a imagem** de qualquer carta pelo seletor (“Usar esta imagem em N slot(s)”), **multiplicar** (“Completar os N com a mesma imagem”, a mesma imagem repetida em N slots) e **tirar** uma atribuição (×). Só a imagem sem atribuição é “sobra” e pede “incluir ou não”. Regra pura em `atribuir()` (`site/lista.js`, testada); estado em `sessao.atribManuais`/`atribBloqueios`; na Montagem a imagem repetida entra N vezes (cada cópia numerada).

## Vitrine do cliente: `/conferencia/<código>` (nov/2026)
Subpágina só para **mostrar imagens a um cliente**: grade no estilo da Vitrine de Sets/bot, **só rolagem** (sem busca, filtro, zoom, clique, login ou botão), `noindex`, sem analytics. O Chelis publica pela página de pedidos; o cliente abre o link.
- **Publicar** (painel “Vitrine para o cliente”, no alto de `site/index.html`, `site/vitrine_pub.js`): com o Google conectado, “Ler pedidos” → pedido (e subpasta) → “Ler imagens”. Cada imagem tem “mostrar” e **legenda** editável (padrão: nome do arquivo sem extensão, ` (ID)` e marcas de cópia; cópias do mesmo ID do MPCFill aparecem uma vez, opção ligada por padrão). Título (padrão: nome do pedido) e **prazo em minutos (padrão 120, 5 a 10080)**. “Publicar” pede confirmação na página, compartilha cada imagem por link (`permissions` `anyone`/`reader`, 4 em paralelo, com progresso; as que falham ficam de fora e são listadas), manda a lista ao Worker e mostra o link. Se o Worker recusar, o compartilhamento é desfeito (nada fica exposto sem vitrine).
- **Cliente** (`site/vit/vitrine.html`, `site/vit/`): dois modos num seletor no topo e, **clicando numa carta, um popup** com ela sozinha, inteira, no tamanho da rolagem, sobre um véu preto leve (rgba 0,0,0,.45), com o **X centralizado abaixo**; fecha clicando fora da carta, no X ou com Esc (a carta mantém inclinação e brilho; a rolagem da página trava enquanto aberto). Fora isso nada é clicável: **Grade** (padrão) e **Rolagem** (uma carta grande por vez, descendo, com `scroll-snap`, imagem de 800 px); **Efeitos copiados do carrossel do bot** (`app/web`): carta inclina em 3D com o ponteiro (mouse, ou o dedo enquanto toca) com faixa holográfica e reflexo que seguem o ponteiro; fundo desfocado com a arte da carta em foco (duas camadas com fade; na rolagem é a carta do centro, na grade a que está sob o ponteiro); cartas sobem e aparecem escalonadas; na rolagem a carta do centro cresce e as outras esmaecem. `prefers-reduced-motion` desliga tudo isso. Lê `GET <worker>/vitrine/<código>` e mostra miniaturas do Drive (`drive.google.com/thumbnail?id=…&sz=w480`), carregadas só perto da tela (IntersectionObserver), com nova tentativa em caso de falha. Prazo acabado/inexistente: “Esta vitrine não está mais no ar”. `site/_redirects` reescreve `/conferencia/*` para `/vit/vitrine` (a Cloudflare tira o `.html` com um 308 e o código do link se perderia; o destino fica fora de `/conferencia`: a Cloudflare ignorou a regra quando o destino casava com o próprio padrão e serviu a página de pedidos); `site/_headers` põe `X-Robots-Tag` e `no-store`. Código = nome sem acento + 8 letras/números aleatórios (`joao-torneio-k7x2q9mn`). Lógica pura em `site/vitrine_lib.js` (testes em `site/test/vitrine.test.mjs`).
- **Despublicar / no ar:** a lista “No ar” (guardada no `localStorage`) tem **Copiar link** e **Despublicar** (apaga a lista no Worker e **tira o compartilhamento** das imagens). Passado o prazo o link já para de funcionar; o compartilhamento das imagens só é desfeito automaticamente **com esta página aberta e o Google conectado** (varredura a cada 30 s); senão, por Despublicar.
- **Limite honesto:** é discrição, não senha. Quem tiver o link direto de uma imagem do Drive a vê enquanto estiver compartilhada. Se o Workspace do `chelisplace.com` bloquear compartilhamento por link, a publicação avisa o erro.
- **Worker:** `worker/src/vitrine.js` (testes em `worker/test/vitrine.test.mjs`); precisa do **KV `VITRINES`** (ver `docs/worker_avisos.md`).
