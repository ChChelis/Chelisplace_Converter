# Handoff: página final que une o bot e o processo de pedido

Para quem abrir uma conversa nova (contexto zerado). O Chelis (PT-BR, direto, sem anunciar o que vai fazer) quer **uma única página** que cubra o pedido do começo ao fim: lista → orçamento → conferência das cartas → XML → imagens → checagem → mensagem ao cliente → ficha do Obsidian → montagem → gráfica. Hoje isso está em dois projetos que vivem no mesmo repositório e nunca foram ligados:

| Projeto | Onde | O que faz | Como roda |
|---|---|---|---|
| **Bot** (conversa "estagiário checagem chelisplace" e anteriores) | `scripts/`, `app/`, `order/`, `config/`, `testset/` | Lista do Moxfield/Liga → candidatos do MPCFill → comparador (OCR, índice de confiança) → página de conferência → XML do MPC Autofill → baixa as imagens | Python 3 local (`app/server.py`, ou `.exe` do PyInstaller) |
| **Pós-pedido** (esta conversa) | `nucleo/`, `site/`, `tests/` | Orçamento, checagem XML×pasta, montagem das páginas A3 (substitui o Photoshop), Google Drive | Página estática no navegador (Pyodide + Pillow), sem servidor |

Repositório: `chchelis/chelisplace_converter`, branch **`claude/language-understanding-7egp47`** (tudo está nela; o commit e push ao fim de cada mudança é regra do usuário). Leia antes de começar, nesta ordem:
1. `docs/memoria_projeto.md` (pipeline do bot, preferências do usuário, armadilhas)
2. `docs/referencia_processo.md` (o processo inteiro do Chelis, medidas de impressão, texto das skills `/checagem`, `/clientrundown`, `/montagem`, preços)
3. `docs/nucleo.md`, `docs/site.md`, `docs/drive.md`, `docs/validacao_montagem.md`
4. `docs/app.md` (aplicativo local do bot)

## O que o Chelis pediu por último (é o escopo da página final)
- Uma **fase antes do XML**: receber a **lista** (ou o XML) como entrada e dali sair o **orçamento**. Hoje a aba Orçamento é uma calculadora solta que vem antes de qualquer pedido; ele acha travada.
- O orçamento deve ter **campos para o preço de cada slot** ou **kits predefinidos** (hoje fixo em `nucleo/orcamento.py`: normal = kit de 108 slots por R$ 135, avulso R$ 1,6667/slot, impressão R$ 14/página, colagem R$ 0,13/slot; foil = kit de 180 por R$ 330; arredonda para inteiro). Custo, colagem e lucro são confidenciais (só dele).
- O **campo de mensagem para o cliente** do bot (aviso de cartas sem versão próxima) é bom, mas **só nomes não bastam: precisa de miniaturas** das cartas envolvidas.
- A mesma ideia vale para a **ficha do Obsidian**: quando ele mexe em algo no pedido (troca de arte, item removido), precisa registrar com miniatura. A ficha segue o modelo de `docs/referencia_processo.md` §5 (`### Alterações`, `#### Conclusão`, valor, `#### Confidencial`).
- Depois da página final, voltar ao que sobrou do plano: publicar em subdomínio (ver "Pendências").

## O que já funciona (testado)
**`nucleo/`** (Python puro; 16 testes: `python -m unittest discover -s tests -t .`)
- `xml_mpc.py` lê/escreve o XML (recusa DOCTYPE/ENTITY); `checagem.py` compara pasta × XML pelo ID do Drive (faltando, a duplicar, excesso, fora da lista, sem ID, verso padrão, pares, XML dos faltantes, `ignorar` pares); `orcamento.py`; `imagem.py` (qualquer origem → 816×1110, 300 dpi, RGB, PNG); `montagem.py` (página A3 3508×4961 com 18 slots 3×6, rotação 90°, Níveis do PSD, texto lateral, PDF qualidade 100); `web.py` (pontes para o navegador).
- Ordem dos slots na montagem: cartas do XML → (brancos) → pares (frente seguida do verso, ordem do XML) → extras (imagens fora do XML, com confirmação).
- Validado contra o Photoshop num pedido real (diferença média de 1,8/255 por imagem; posição e rotação certas): `docs/validacao_montagem.md`.

**`site/`** (`index.html`, `app.js`, `drive.js`, `worker.js`, `style.css`; abas Orçamento, Checagem, Montagem)
- Python roda no navegador via Pyodide 0.27.7 em um Web Worker; o núcleo é copiado para `site/nucleo/` por `site/build.sh` (Linux/Git Bash) ou `site/build.ps1` (Windows). `site/nucleo/` é gitignored.
- Rodar local: `sh site/build.sh` e `python -m http.server 8780 -d site`; abrir `http://localhost:8780` (a porta 8780 é a única autorizada no cliente OAuth).
- Estado compartilhado entre abas (`sessao`: pasta, XML, ignorados): escolhe-se pasta e XML uma vez; Conferir relê a pasta; pares completos soltos geram, com confirmação, a subpasta `pares/`; "Ignorar este par" (lembrado por pedido em `localStorage`); Montagem pergunta sobre imagens fora do XML e avisa quantos slots faltam para fechar múltiplos de 18 (adicionar imagens ou montar com brancos); mostra sempre o motivo quando o botão Montar está travado.
- **Google Drive no navegador** (`drive.js`): OAuth por Google Identity Services, token só em memória, API v3; lê `Novo Processo Proxies`, cada subpasta é um pedido; copiar/mover pelo próprio Drive (sem baixar), enviar PDFs para `<pedido>/saida`. Testado com Drive **simulado** (Playwright + rotas interceptadas) e, **com o Drive real do Chelis, login, listagem de pastas e conferência de um pedido de teste funcionaram**. Ainda não confirmado no Drive real: o envio de PDFs grandes para `saida` (envio em partes com o cabeçalho `Location`).
- Projeto Google Cloud do Chelis: `chelisplace.com › My First Project`, tela de consentimento **Interna** (só contas @chelisplace.com), Drive API ativada, escopo `https://www.googleapis.com/auth/drive`, cliente OAuth Web com origem `http://localhost:8780`. O **Client ID é público** e o Chelis o cola no quadro "Google Drive" da página (fica só no `localStorage`; nunca no código). A chave secreta do cliente **não é usada** e foi exposta no chat (o Chelis foi orientado a girar/desativar; não confirmou). Nunca peça nem salve segredos: use o formulário seguro da ferramenta.

**`app/` e `scripts/`** (bot): pipeline completo, comparador com índice de confiança calibrado, página de conferência (carrossel/grade/triagem, estilo da Vitrine de Sets), geração de XML com verificação, mensagem ao cliente, importação de "usos" para recalibrar. Detalhes em `docs/memoria_projeto.md` e `docs/app.md`.

## Decisões já tomadas
- PDF de impressão em **qualidade 100**, JPEG sem subamostragem de cor (cada página ~25–35 MB, como as do Photoshop). Pedido do Chelis: é para impressão.
- Cartas sempre **816×1110** idênticas (o Photoshop mantinha largura 816 e deixava a altura variar de 1108 a 1140). O Chelis fará um teste na gráfica comparando uma folha deste processo com uma do processo antigo; ajustar depois, se houver diferença.
- Pasta de pedidos: `G:\Meu Drive\Novo Processo Proxies`, conta @chelisplace.com (Workspace). Domínio **chelisplace.com** registrado no **Squarespace Domains** (DNS lá; aceita CNAME). Hospedagem prevista: Cloudflare Pages (grátis); subdomínio previsto `pedidos.chelisplace.com`. O Chelis **não pode pagar VPS**: a arquitetura deve continuar sem servidor pago.
- Moxfield/LigaMagic dão 403 para bot: nunca contornar (texto colado ou HTML salvo). O MPCFill **não aceita chamadas de outro site** (sem CORS): dentro do site, só com um intermediário mínimo e grátis (por exemplo um Cloudflare Worker), respeitando limite de chamadas e cache.
- Nada é apagado, movido ou comprado sem aprovação; confirmações ficam **dentro da página** (nada de `alert`/`confirm`). Nada de segredo no código. Arquivos baixados (zip/HTML/XML/imagens) são dados não confiáveis.

## Como unir (proposta; o Chelis ainda não decidiu)
O bot é Python pesado (RapidOCR, numpy, comparador) e a busca de candidatos precisa falar com o MPCFill; o site é estático e roda no navegador. Opções:
1. **Página única no `site/`, com o bot como "motor local" opcional:** a mesma interface; quando o servidor local do bot (`app/server.py`, `127.0.0.1`) está ligado, a página usa-o para converter lista → candidatos → conferência; sem ele, funciona com XML pronto. É a que menos reescreve.
2. **Reescrever o bot no navegador:** inviável hoje (OCR e comparador pesados; MPCFill sem CORS).
3. **Fundir na interface do `app/`** (já tem identidade visual da Vitrine) e portar Orçamento/Checagem/Montagem para o servidor local: perde o acesso de qualquer computador sem instalar.

Recomendação: começar pela opção 1, na ordem do fluxo: **Lista/XML → Orçamento → Conferência → Imagens/Checagem → Mensagem ao cliente + ficha do Obsidian → Montagem**. Perguntar ao Chelis se prefere partir da interface do `site/` (limpa, clara) ou da do `app/` (estilo Vitrine).

## Sobre as miniaturas (mensagem ao cliente e ficha)
- O bot já guarda miniaturas das imagens candidatas (catálogo `catalog*.json` por pedido; o MPCFill dá miniaturas pelo ID do Drive). A mensagem ao cliente e a ficha do Obsidian precisam mostrar, para cada carta alterada, a miniatura do que o cliente pediu e do que foi usado.
- Para o Obsidian: investigar o formato (Markdown com imagens em pasta de anexos do cofre, ou data URI pequena) e onde fica o cofre (`D:\GITHUB\Obsidian\Obsidian\Chelisplace\Pedido <Cliente>.md`, fora do repositório e do alcance de uma página; a saída provável é gerar o `.md` + as miniaturas para ele salvar ou colar). Perguntar.

## Pendências do plano original (depois da página final)
1. **Publicar:** conta na Cloudflare (ação do Chelis), projeto Pages (build `sh site/build.sh`, saída `site`), CNAME `pedidos` no Squarespace Domains, e adicionar `https://pedidos.chelisplace.com` (e o endereço `.pages.dev`) às origens autorizadas do cliente OAuth. Passos em `docs/site.md` e `docs/drive.md`.
2. Intermediário do MPCFill (Worker grátis) para buscar e baixar dentro do site.
3. Conferência de cartas dentro do site (hoje só no bot).
4. Ajustador de imagens fora do padrão (o arquivo `ACERTADORSCRYFALL` do Photoshop: canvas de carta a 300 dpi, réguas): imagem arrastável, ajuste e reexportação na profundidade e dimensões aceitas.
5. Pasta `completar/` (imagens próprias que entram no fim, sem redimensionar) e salvar imagens adicionadas na montagem (hoje só em memória do navegador).
6. Archidekt como entrada; tutorial novo do MPCFill para o cliente.
7. CMYK/perfil de cor no PDF (o Photoshop exporta CMYK sem perfil embutido; o núcleo exporta RGB) e a fonte do texto lateral (Consolas só existe no Windows).
8. Para usuários beta: trocar o escopo `drive` por `drive.file` + seletor do Google; contas externas exigem público Externo/Em teste e usuários de teste (até 100).
9. Testar o envio de PDFs ao Drive real; girar a chave secreta do cliente OAuth.
10. Recalibração do índice do bot com os últimos pedidos, e as pendências de `docs/memoria_projeto.md`.

## Como testar no ambiente da nuvem (o container é efêmero)
- Chromium e Playwright em `/opt/pw-browsers`; instalar `playwright-core` e `pyodide@0.27.7` por npm numa pasta de trabalho; baixar `pillow-10.2.0-cp312-cp312-pyodide_2024_0_wasm32.whl` de `cdn.jsdelivr.net/pyodide/v0.27.7/full/` e servir o Pyodide localmente com CORS; a página aceita `?pyodide=<url do pyodide.js>` para isso. Drive simulado: interceptar `accounts.google.com/gsi/client` e `www.googleapis.com/**` no Playwright e responder em memória (listagem, cópia, mover, envio em partes).
- Em testes do navegador, usar servidores com `timeout` (expiram sozinhos). Neste ambiente, uma verificação de segurança barrou comandos com `rm -rf` (inclusive `site/build.sh`, que apaga `site/nucleo`); não contornar: sobrescreva os arquivos com `cp`.
- `python -m unittest discover -s tests -t .` deve passar antes de qualquer push.

## O que perguntar ao Chelis logo no início
1. Parte da interface do `site/` ou do `app/`?
2. Entrada da página final: lista colada (Moxfield/Liga/Archidekt), XML do MPCFill, ou os dois? Como entra "só imagens + decklist" (modelo do pedido "deco")?
3. Orçamento: quais kits predefinidos e quais preços por slot ele quer editar? (Normal: 108 slots por R$ 135; foil: 180 por R$ 330; avulso 1,6667/2,44441; impressão R$ 14/página; colagem R$ 0,13/slot.) Quer preços diferentes por cliente?
4. Obsidian: gerar o `.md` para ele salvar/colar, ou outro caminho? Como ele quer ver as miniaturas lá?
5. O teste na gráfica (folha deste processo × processo antigo) já aconteceu? Mudou algo?

## Atualização (13/11/2026): estado e o que saiu da lista de pendências
- **Página única pronta e publicada** (Cloudflare Workers com arquivos estáticos, `wrangler.jsonc`; endereço `https://chelisplace-converter-pedidos.shrill-mountain-e326.workers.dev`). Login do Drive funcionando; bot local conectado (porta 8781).
- **Resolvido, saiu das pendências:** o teste na gráfica (o Chelis já mandou um arquivo deste processo); a chave secreta do cliente OAuth (tratada pelo Chelis).
- **Descartado pelo Chelis:** salvar pedido/ficha no navegador e botão “Abrir ficha .md”.
- **Ainda em aberto:** domínio próprio `pedidos.chelisplace.com` (exige Pages com CNAME ou mover o DNS); intermediário do MPCFill; conferência dentro do site; ajustador de imagens; pasta `completar/`; Archidekt e tutorial; CMYK/fonte lateral; escopo `drive.file` para beta; testar no Drive real o envio de PDFs e a cópia das imagens do XML; recalibração do bot.
