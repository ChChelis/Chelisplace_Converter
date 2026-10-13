# Plano: bot Moxfield para MPCFill (Chelisplace)

## Problema

O cliente manda uma lista do Moxfield. Para cada carta, preciso achar no MPCFill a imagem que seja a mesma versão da carta do Moxfield. Nomes e metadados do MPCFill não são confiáveis, então hoje eu comparo olhando, e isso custa muito tempo.

## Ideia central

Comparar a imagem, não o texto. O Moxfield diz qual impressão exata o cliente quer (set e número de colecionador). O Scryfall tem a imagem oficial dessa impressão. O bot pega essa imagem de referência e escolhe, entre os candidatos do MPCFill, o que mais se parece com ela.

## Decisão tomada

"Mesma versão" quer dizer o mais próximo possível da carta inteira: ilustração, moldura e símbolo do set. Não basta a arte. Isso muda o comparador: ele pontua a carta inteira, mas também pontua separado a ilustração, a moldura (cor e formato da borda e da caixa de texto) e o símbolo do set, e soma com pesos. O símbolo do set é pequeno e some num hash da carta inteira, por isso precisa de recorte e nota própria. Card sem símbolo do set legível não é descartado: ele recebe nota zero no símbolo, perde esses pontos, e ainda ganha se somar mais que os outros candidatos. Quando nenhum candidato chega perto, o bot não força: mostra o melhor e marca para revisão.

## Fases (cada uma termina com algo que roda)

1. Sondagem (meio dia). Antes de escrever qualquer bot, descobrir como o MPCFill funciona por dentro. O projeto é código aberto (MPC Autofill, licença GPL-3.0, repositório chilli-axe/mpc-autofill, com wiki). Ler a wiki e abrir a aba de rede do navegador numa busca no site. Hipótese a confirmar: o site chama uma API própria que devolve a lista de candidatos com link da imagem. Se existir, o bot chama essa API direto e não precisa clicar em nada no site. Também confirmar se dá para importar um pedido em XML, o que deixaria o bot gerar o arquivo de pedido em vez de operar a tela.
2. Entrada (meio dia). A entrada é o link do deck no Moxfield, porque a exportação pode dar problema. O bot abre a página do deck num navegador de verdade (Playwright, no meu computador), lê as cartas com set e número de colecionador direto da página e, se precisar, abre outras páginas do Moxfield sozinho (visão de lista, impressão de cada carta). O Moxfield costuma ter proteção contra robôs, então: ir devagar, usar um navegador visível e com perfil persistente, e não tentar burlar bloqueio nenhum. Se o Moxfield barrar, o bot para e avisa, e o plano B é eu colar o texto da lista. Se alguma carta vier só com nome, resolver a impressão pelo Scryfall e marcar como "impressão adivinhada".
3. Referência (poucas horas). Para cada carta, baixar a imagem oficial do Scryfall da impressão pedida e guardar em cache em disco. Marcar de antemão as regiões fixas: ilustração, moldura, símbolo do set.
4. Comparador (1 a 2 dias, a parte difícil). As imagens do MPCFill costumam vir com margem de sangria e proporção diferente da oficial, então primeiro normalizar: cortar a margem e redimensionar para o mesmo tamanho da referência. Depois dar quatro notas por candidato: carta inteira, ilustração, moldura e símbolo do set, e combinar com pesos que se ajustam no conjunto de teste. Começar simples (hash perceptual por região mais comparação de cor da moldura). Se errar, trocar a nota da ilustração e da carta inteira por embeddings de imagem (modelo tipo CLIP ou DINOv2, roda no PC sem GPU, só mais devagar). O símbolo do set provavelmente precisa de comparação em tamanho ampliado ou de casar com o símbolo oficial do Scryfall. Montar antes um conjunto de teste com 30 a 50 pares que eu já conferi à mão, incluindo casos difíceis (mesma arte com molduras diferentes, reimpressões), e só aceitar o comparador que acertar quase todos.
5. Decisão com confiança. Pontuar cada candidato. Acima de um limite alto, escolhe sozinho. Entre limites, escolhe o melhor mas marca para revisão. Abaixo, não escolhe e lista os 3 melhores. Nunca decidir calado quando está em dúvida.
6. Saída. Gerar o pedido (XML ou lista de seleções) e um relatório simples: carta, escolha, nota, e a fila de revisão com as imagens lado a lado numa página HTML local. O download continua sendo meu passo manual no começo.

## Versão mínima (o que o Code deve construir primeiro)

Um script de linha de comando só. Entrada: link do deck. Saída: pedido mais relatório HTML. Sem interface, sem banco de dados, sem servidor, sem cadastro de usuários. Cache de imagens em uma pasta. Um teste com os pares conferidos à mão que falha se a taxa de acerto cair.

## Tamanho do pedido

Pedido mínimo de 108 imagens, então o bot tem que aguentar 108 ou mais cartas por rodada, cada uma com vários candidatos no MPCFill. Consequências: guardar em disco as notas e características já calculadas de cada imagem (referência e candidatos), para que cartas repetidas entre pedidos não sejam baixadas nem recalculadas; processar as cartas em lotes com pausa entre as requisições; salvar o progresso a cada carta para retomar se cair no meio; e relatório só com as dúvidas em destaque, porque revisar 108 itens um por um mataria o ganho de tempo. Medir quanto tempo leva um pedido de 108 no teste e aceitar algo na casa de poucos minutos por carta como limite máximo.

## Regras de bom comportamento

- Pouca requisição por segundo ao MPCFill e ao Scryfall, e cache para nunca baixar a mesma imagem duas vezes. O Scryfall pede identificação do programa e intervalo entre chamadas.
- Antes de automatizar o site, ler os termos de uso do MPCFill. Se houver API, usar a API em vez de simular cliques.
- Não colocar senha ou chave no código.
- O bot roda no meu computador (o navegador automatizado do Code), não no ambiente de nuvem, porque a nuvem só alcança poucos sites.

## Ponytail

Sim, encaixa bem aqui. Pedir ao Code para trabalhar em modo Ponytail: começar pela sondagem, reaproveitar o que o projeto aberto já oferece, escrever o menor script que resolve, e só trocar o hash por embeddings se o teste mostrar que precisa.

## Prompt para colar no Code

Quero um bot de linha de comando para a Chelisplace. Entrada: link de um deck do Moxfield. Para cada carta, achar no MPCFill o candidato cuja imagem mais se parece com a imagem oficial do Scryfall da impressão pedida, comparando a imagem inteira (ilustração, moldura e símbolo do set, com nota separada para cada uma) e não nomes ou metadados. Use modo Ponytail. Comece só pela fase 1 do plano em plano_bot_mpcfill.md: descubra como o MPCFill expõe busca e candidatos (leia a wiki do repositório chilli-axe/mpc-autofill e a aba de rede do site), diga se dá para usar uma API ou importar um pedido em XML, e pare com um relatório curto antes de construir o resto. Peça meu conjunto de teste de pares conferidos antes da fase 4.

## Em aberto

- O pedido final é feito pelo site ou pela ferramenta de desktop do MPC Autofill?
