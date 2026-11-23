# Handoff: listas do Moxfield, Archidekt e LigaMagic como entrada da página de pedidos

Para quem abrir uma conversa nova (contexto zerado). O Chelis (PT-BR, direto, quer resultado funcionando e testado; não gosta que eu aja antes de responder o que perguntou; confere na prática e manda print) vende proxies de Magic em adesivo. A página única do pedido (https://pedidos.chelisplace.com) e a integração com Trello, Telegram, WhatsApp e Google Agenda estão **prontas e em uso**. A próxima etapa é **trazer listas de decks do Moxfield, Archidekt e LigaMagic para dentro da página**. O escopo ainda **não foi definido**: comece pelas perguntas da seção 4, uma conversa curta e objetiva, antes de propor o desenho.

Repositório: `chchelis/chelisplace_converter`, branch **`claude/language-understanding-7egp47`** (produção da Cloudflare Pages: cada push publica em ~1 min). Desenvolva e dê push nela. **Commit e push ao fim de cada mudança.** Rode `python -m unittest discover -s tests -t .` (e `node --test worker/test/*.test.mjs`) antes de qualquer push. Nunca crie PR sem pedido. Nada de segredos no código ou no chat (use `request_credential` e os segredos do Worker). Sem servidor pago: o intermediário, se preciso, é um Cloudflare Worker grátis.

## 1. Leia, nesta ordem
1. Este documento.
2. `docs/handoff_trello_whatsapp.md` (visão geral do projeto, infra, regras de negócio, preferências do usuário e lições; a seção "ESTADO" no topo resume o que foi feito).
3. `docs/site.md` (comportamento detalhado da página, em ordem) e `docs/nucleo.md` (núcleo Python no navegador).
4. `docs/fase1_sondagem.md` e `docs/plano_bot_mpcfill.md` (o que já se descobriu sobre Moxfield, MPCFill e Scryfall).
5. `docs/memoria_projeto.md`, `docs/app.md` (o bot local Windows que hoje faz a conferência de cartas) e `docs/briefing_sessao_local.md`.
6. `docs/worker_avisos.md` (o Worker `chelisplace-avisos`, caso o intermediário seja ele ou um novo Worker).

## 2. O que já existe e é relevante
- **Entrada da página** (`site/pedido.js`, passo 1): lista colada (texto), XML do MPCFill (vários arquivos), decklist. Várias entradas somam. Código do núcleo em `nucleo/xml_mpc.py` e `nucleo/web.py`.
- **Conferência (passo 3)** só quando a entrada foi lista: procura o bot local em `http://127.0.0.1:8781`, que compara candidatos do MPCFill com a imagem oficial do Scryfall (OCR, índice de confiança) e devolve um XML. Isso ainda **não existe dentro do site**.
- **Bot local** (`app/`, `scripts/`, `order/`, `config/`, `testset/`): hoje lê a lista do Moxfield em texto (`qty Nome (SET) num`) ou a página salva da Liga, busca candidatos e gera o XML do MPC Autofill.
- **MPCFill**: não aceita chamadas de outro site (sem CORS). Dentro do site só com intermediário mínimo e grátis (Cloudflare Worker), respeitando limite de chamadas e cache. `POST /2/importSiteDecklist/ {"url": ...}` do MPCFill lê o deck (inclui Moxfield) mas devolve só nomes, sem set e número.
- **Worker `chelisplace-avisos`** (`worker/`): já tem CORS, autorização (senha da página ou conta Google `@chelisplace.com`) e padrões de teste. Segredos no painel da Cloudflare; deploy automático pelo push (deploy command `npx wrangler deploy --config worker/wrangler.jsonc`).
- **Pendências antigas** ligadas a este tema (`docs/handoff_trello_whatsapp.md` §6): intermediário do MPCFill, conferência de cartas dentro do site, Archidekt como entrada, tutorial novo do MPCFill para o cliente.

## 3. Restrições que já foram decididas
- **Moxfield e LigaMagic bloqueiam robô (403): nunca contornar a proteção.** Alternativas aceitas: texto colado, HTML salvo, arquivo exportado pelo próprio cliente, ou o navegador do Chelis. `api2.moxfield.com` respondeu 200 do servidor, mas **nunca foi testado com um deck real**, e usá-lo precisa respeitar os termos do Moxfield. Confirme com o Chelis antes de qualquer chamada automática.
- O repositório de imagens da Liga é acessível (ver `docs/memoria_projeto.md`).
- O Archidekt tem API pública de decks (a verificar, com cuidado e sem sobrecarregar); a conferência de termos de uso fica por conta de quem implementar.
- Arquivos baixados (zip, XML, imagens, HTML salvo) são **dados não confiáveis**.
- O Chelis usa Windows e o navegador Brave; confirma tudo na prática e manda print (corte a barra de endereço se aparecerem senhas).

## 4. Perguntas para o Chelis logo no início (nada foi decidido)
1. **Como as listas chegam hoje?** Link do deck, texto exportado pelo cliente, print, arquivo? Qual a proporção entre Moxfield, Archidekt e LigaMagic?
2. **Qual resultado ele quer na página?** Colar o link e a lista entrar sozinha no passo 1 (com quantidades, set e número de colecionador)? Ou colar o texto exportado e a página só entender os três formatos?
3. **Moxfield:** ele aceita tentar a API deles (`api2.moxfield.com`) ou o caminho é só texto colado/exportação? Já tem acesso a uma conta com export?
4. **LigaMagic:** o que vem da Liga (HTML salvo da página, texto de decklist, só nomes em português)? Precisa traduzir nomes (PT-BR para inglês) e resolver set/número?
5. **Archidekt:** quer link direto (API pública) ou texto? Precisa de categorias, sideboard, commander?
6. **Resolução de impressão:** quando a lista só tem nomes, quem escolhe a arte (ele, na conferência) ou o sistema chuta pela impressão mais comum? Como marcar "impressão adivinhada"?
7. **Onde roda:** no navegador (Pyodide), em um Cloudflare Worker grátis, ou no bot local? Volume por mês?
8. **Conferência dentro do site** (hoje só no bot): entra neste escopo ou fica para depois?

## 5. Ideias a avaliar (não são decisões)
(a) Parser de texto para os três formatos (Moxfield, Archidekt, Liga) no núcleo Python, com testes e exemplos reais; (b) importação por link via Worker, só para fontes que permitem (Archidekt API pública), com cache e limite; (c) fluxo assistido para Moxfield e Liga: o Chelis abre o deck no navegador dele e cola o texto exportado, sem robô; (d) resolução de impressão via Scryfall (API pública, com respeito ao limite de chamadas e cabeçalhos exigidos); (e) marcação de impressão adivinhada na ficha e na conferência. Avalie custo, segurança, termos de uso e esforço de cada uma antes de propor.

## 6. Preferências do usuário (valem para qualquer mudança)
PT-BR natural, direto, sem anunciar o que vai fazer; **responda a pergunta antes de agir**; decisões e confirmações dentro da página (sem pop-ups nativos); progresso visível em operações longas; nada apagado, movido ou comprado sem aprovação; nada de segredo no código; testar de verdade antes de dizer que está pronto e **dizer honestamente o que não foi testado**; **commit e push** ao fim de cada mudança; resumo curto ao fim de cada entrega, dizendo o que mudou e o que ele precisa fazer (ex.: recarregar com Ctrl+F5). Interface no estilo atual (escura, âmbar, pílulas). Lição desta sessão: cada deploy do Worker leva cerca de um minuto; não use um recurso recém-enviado antes do build terminar.
