import test from "node:test";
import assert from "node:assert/strict";
import { lerCard, entradasPorCard, montarResumo, recemAtrasados, avisoMovimento, linkWaCliente } from "../src/avisos.js";

const br = (s) => Date.parse(s + "-03:00");

test("lerCard pega cliente, telefone e slots", () => {
  const i = lerCard({ id: "1", name: "Ana · 216 slots", desc: "Cliente: Ana Souza\nTelefone: +55 31 99999-0000\nSlots: 216" });
  assert.deepEqual([i.cliente, i.telefone, i.slots], ["Ana Souza", "+55 31 99999-0000", 216]);
  assert.equal(lerCard({ id: "2", name: "Bia · 108 slots", desc: "" }).slots, 108);
});
test("entradasPorCard usa a ação mais nova e cai para dateLastActivity", () => {
  const acoes = [
    { date: "2026-11-18T14:00:00Z", data: { card: { id: "a" }, listAfter: { id: "L2" } } },
    { date: "2026-11-17T14:00:00Z", data: { card: { id: "a" }, listAfter: { id: "L1" } } },
  ];
  const m = entradasPorCard(acoes, [{ id: "a", dateLastActivity: "2026-01-01T00:00:00Z" }, { id: "b", dateLastActivity: "2026-11-10T00:00:00Z" }]);
  assert.equal(m.a, Date.parse("2026-11-18T14:00:00Z"));
  assert.equal(m.b, Date.parse("2026-11-10T00:00:00Z"));
});
test("resumo marca atrasados e conta totais", () => {
  const listas = [{ id: "L1", name: "Novos pedidos" }, { id: "L2", name: "Finalizado" }];
  const cards = [{ id: "a", name: "Ana · 108 slots", desc: "", idList: "L1" }, { id: "b", name: "Bia · 18 slots", desc: "", idList: "L2" }];
  const entradas = { a: br("2026-11-17T10:00:00"), b: br("2026-11-10T10:00:00") };
  const t = montarResumo({ listas, cards, entradas, agoraMs: br("2026-11-18T10:00:00"), titulo: "T" });
  assert.match(t, /Ana · 108 slots.*ATRASADO/);
  assert.match(t, /Bia.*(?!ATRASADO)/);
  assert.match(t, /2 pedido\(s\), 1 atrasado/);
});
test("recemAtrasados só pega o que venceu na última hora", () => {
  const listas = [{ id: "L1", name: "Novos pedidos" }];
  const cards = [{ id: "a", name: "Ana · 1 slots", desc: "", idList: "L1" }];
  const entradas = { a: br("2026-11-17T10:00:00") }; // prazo 17/11 17h
  assert.equal(recemAtrasados({ listas, cards, entradas, agoraMs: br("2026-11-17T17:30:00") }).length, 1);
  assert.equal(recemAtrasados({ listas, cards, entradas, agoraMs: br("2026-11-17T18:30:00") }).length, 0);
});
test("aviso de movimento para Gráfica traz link do cliente e do grupo", () => {
  const { texto, botoes } = avisoMovimento({ cardNome: "Ana · 108 slots", de: "Montagem", para: "Gráfica", card: { name: "Ana · 108 slots", desc: "Telefone: +55 31 98888-7777" } });
  assert.match(texto, /De _Montagem_ para _Gráfica_/);
  assert.equal(botoes.length, 2);
  assert.match(botoes[0][0].url, /^https:\/\/wa\.me\/5531988887777\?text=/);
  assert.match(botoes[1][0].url, /^https:\/\/wa\.me\/\?text=/);
});
test("coluna sem mensagem ao cliente só tem botão do grupo", () => {
  const { botoes } = avisoMovimento({ cardNome: "x", de: "Novos pedidos", para: "Montagem", card: { name: "x", desc: "" } });
  assert.equal(botoes.length, 1);
});
test("linkWaCliente sem telefone devolve null", () => assert.equal(linkWaCliente("", "oi"), null));

import { montarCard } from "../src/avisos.js";
test("montarCard usa só campos permitidos e nunca vaza custo/lucro/pix", () => {
  const { name, desc } = montarCard({ cliente: "Ana", telefone: "+55 31 9", slots: 216, paginas: 12, valor: 270, pastaUrl: "https://drive.google.com/drive/folders/abc",
    custo: 99, lucro: 50, chavePix: "segredo@pix", descontos: "x", alteracoes: ["Troca de arte X"] });
  assert.equal(name, "Ana · 216 slots");
  assert.match(desc, /Valor cobrado: R\$ 270,00/);
  assert.match(desc, /Pasta do Drive: https:\/\/drive\.google\.com\//);
  assert.match(desc, /- Troca de arte X/);
  assert.doesNotMatch(desc, /segredo|custo|lucro|99|desconto/i);
});
test("montarCard rejeita pasta que não é do Drive e lida com lixo", () => {
  const { desc } = montarCard({ cliente: "B", slots: "abc", valor: -5, pastaUrl: "https://evil.example/x" });
  assert.doesNotMatch(desc, /evil/);
  assert.match(desc, /Slots: 0/);
});

import { quintoDiaUtil, inicioJanelaFinalizados, avisoNovo } from "../src/avisos.js";
test("5º dia útil: nov/2026 = sex 06/11 (01/11 é domingo); dez/2026 = sex 08/12? (conta seg-sex)", () => {
  assert.equal(quintoDiaUtil(2026, 10), br("2026-11-09T00:00:00")); // 02/11 é feriado: 3,4,5,6,9
  assert.equal(quintoDiaUtil(2026, 11), br("2026-12-07T00:00:00")); // ter 1,2,3,4,sex? 1,2,3,4 + seg 7
});
test("janela de Finalizados troca no 5º dia útil", () => {
  assert.equal(inicioJanelaFinalizados(br("2026-11-18T10:00:00")), br("2026-11-09T00:00:00"));
  assert.equal(inicioJanelaFinalizados(br("2026-11-05T12:00:00")), quintoDiaUtil(2026, 9));
  assert.equal(inicioJanelaFinalizados(br("2026-11-06T12:00:00")), quintoDiaUtil(2026, 9));
  assert.equal(inicioJanelaFinalizados(br("2026-11-09T00:00:00")), br("2026-11-09T00:00:00"));
});
test("resumo só mostra Finalizados da janela atual", () => {
  const listas = [{ id: "F", name: "Finalizado" }];
  const cards = [{ id: "a", name: "Velho · 18 slots", desc: "", idList: "F" }, { id: "b", name: "Novo · 18 slots", desc: "", idList: "F" }];
  const entradas = { a: br("2026-11-03T12:00:00"), b: br("2026-11-10T12:00:00") };
  const t = montarResumo({ listas, cards, entradas, agoraMs: br("2026-11-18T10:00:00"), titulo: "T" });
  assert.match(t, /Novo/); assert.doesNotMatch(t, /Velho/); assert.match(t, /Coluna Finalizado \(1\) - desde 09\/11/);
});
test("aviso de novo pedido", () => {
  const { texto, botoes } = avisoNovo({ card: { name: "Ana · 216 slots", desc: "" }, coluna: "Novos pedidos" });
  assert.match(texto, /\*NOVO PEDIDO:\* Ana · 216 slots/); assert.equal(botoes.length, 1);
});

import { feriadosNacionais } from "../src/avisos.js";
test("feriados nacionais: fixos, Consciência Negra e Sexta-feira Santa", () => {
  const f = feriadosNacionais(2026);
  for (const d of ["2026-01-01", "2026-04-21", "2026-05-01", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25", "2026-04-03"]) assert.ok(f.has(d), d);
  assert.ok(!f.has("2026-02-17")); // carnaval não entra
  assert.ok(feriadosNacionais(2027).has("2027-03-26")); // Sexta Santa 2027
  assert.ok(!feriadosNacionais(2023).has("2023-11-20"));
});
test("5º dia útil pula Sexta-feira Santa (abr/2026 = qua 08/04)", () => {
  assert.equal(quintoDiaUtil(2026, 3), br("2026-04-08T00:00:00"));
});

test("Entrou na coluna: montarCard grava e lerCard lê (hora de Brasília)", () => {
  const { desc } = montarCard({ cliente: "Ana", slots: 18, valor: 30, entrouEm: "2026-11-12T14:00:00-03:00" });
  assert.match(desc, /Entrou na coluna: 12\/11\/2026 14:00/);
  assert.equal(lerCard({ id: "x", name: "Ana · 18 slots", desc }).entrouEm, br("2026-11-12T14:00:00"));
});
test("entrada manual vale no lugar da criação, mas um movimento real posterior vence", () => {
  const card = { id: "a", name: "Ana · 18 slots", desc: "Entrou na coluna: 12/11/2026 14:00", dateLastActivity: "2026-11-18T10:00:00Z" };
  const criacao = { type: "createCard", date: "2026-11-18T10:00:00Z", data: { card: { id: "a" }, list: { id: "L1" } } };
  assert.equal(entradasPorCard([criacao], [card]).a, br("2026-11-12T14:00:00"));
  const mov = { type: "updateCard", date: "2026-11-19T10:00:00Z", data: { card: { id: "a" }, listAfter: { id: "L2" } } };
  assert.equal(entradasPorCard([mov, criacao], [card]).a, Date.parse("2026-11-19T10:00:00Z"));
});

test("montarCard aceita observação livre", () => {
  const { desc } = montarCard({ cliente: "Caixas", slots: 0, paginas: 14, valor: 0, obs: "14 folhas de couché 300g" });
  assert.match(desc, /Obs: 14 folhas de couché 300g/);
});

import { prazoDe } from "../src/avisos.js";
test("Prazo manual vale na coluna de origem e some depois de um movimento", () => {
  const { desc } = montarCard({ cliente: "L", slots: 86, entrouEm: "2026-11-18T11:26:00-03:00", prazo: "2026-11-19T17:00:00-03:00" });
  assert.match(desc, /Prazo: 19\/11\/2026 17:00/);
  const info = lerCard({ id: "x", name: "L · 86 slots", desc });
  const ent = br("2026-11-18T11:26:00");
  assert.equal(prazoDe("Gráfica", ent, info), br("2026-11-19T17:00:00"));
  assert.notEqual(prazoDe("Gráfica", br("2026-11-19T10:00:00"), info), br("2026-11-19T17:00:00")); // card foi movido
});

import { linhaPrevisao, aplicarPrevisao, pegadaGrafica, setLinha, dataHoraBR } from "../src/avisos.js";
const info18 = () => lerCard({ id: "x", name: "A · 18 slots", desc: "" });
test("entrar na Montagem: só o prazo limite para montar (1 expediente)", () => {
  assert.equal(linhaPrevisao("Montagem", br("2026-11-18T10:00:00"), info18(), 0), "Prazo limite para montar: 18/11/2026 17:00");
  assert.equal(linhaPrevisao("Montagem", br("2026-11-18T15:00:00"), info18(), 0), "Prazo limite para montar: 19/11/2026 15:00");
});
test("entrar na Gráfica: previsão de retirada = 3º dia útil (entrada = dia 1) às 17h, mesmo expediente", () => {
  assert.equal(linhaPrevisao("Gráfica", br("2026-11-18T11:26:00"), info18(), br("2026-11-18T11:26:00")), "Previsão de retirada da gráfica: 23/11/2026 17:00");
});
test("Gráfica com Prazo manual e prazo vencido (parte de agora)", () => {
  const { desc } = montarCard({ cliente: "L", slots: 86, paginas: 5, entrouEm: "2026-11-18T11:26:00-03:00", prazo: "2026-11-19T17:00:00-03:00" });
  const info = lerCard({ id: "x", name: "L · 86 slots", desc });
  assert.equal(pegadaGrafica(br("2026-11-18T11:26:00"), info, br("2026-11-19T09:00:00")), br("2026-11-19T17:00:00"));
  assert.equal(pegadaGrafica(br("2026-11-18T11:26:00"), info18(), br("2026-11-30T12:00:00")), br("2026-11-30T12:00:00")); // já vencido: agora (dentro do expediente)
});
test("entrar na Colagem: prazo máximo de colagem pelo tamanho (Rodrigo: 54 páginas = 27h na janela do colador)", () => {
  const { desc } = montarCard({ cliente: "Rodrigo Grupo", slots: 956, paginas: 54, valor: 1260 });
  const info = lerCard({ id: "x", name: "Rodrigo Grupo · 956 slots", desc });
  assert.equal(linhaPrevisao("Colagem", br("2026-11-23T17:00:00"), info, 0), "Prazo máximo de colagem: 25/11/2026 22:00");
});
test("sem previsão em Novos pedidos, Retirada, Pronto para entrega e Finalizado", () => {
  for (const c of ["Novos pedidos", "Retirada", "Pronto para entrega", "Finalizado", "Qualquer"]) assert.equal(linhaPrevisao(c, 0, info18(), 0), null, c);
});
test("aplicarPrevisao troca a linha da etapa anterior e apaga quando não há mais", () => {
  const d = "A: 1\nPrazo limite para montar: x\n\nAlterações:\n- z";
  assert.equal(aplicarPrevisao(d, "Previsão de retirada da gráfica: y"), "A: 1\nPrevisão de retirada da gráfica: y\n\nAlterações:\n- z");
  assert.equal(aplicarPrevisao("A: 1\nPrevisão de entrega: antiga", null), "A: 1");
});
test("setLinha substitui ou acrescenta antes das Alterações", () => {
  assert.equal(setLinha("A: 1\nB: x", "B", "y"), "A: 1\nB: y");
  assert.equal(setLinha("A: 1\n\nAlterações:\n- z", "B", "y"), "A: 1\nB: y\n\nAlterações:\n- z");
  assert.equal(setLinha("A: 1", "B", "2"), "A: 1\nB: 2");
});
test("aviso de movimento e de novo pedido mostram a previsão (vai no texto encaminhado ao grupo)", () => {
  const m = avisoMovimento({ cardNome: "x", de: "Montagem", para: "Gráfica", card: { name: "Ana · 18 slots", desc: "Telefone: +55 31 9" }, previsao: "Previsão de retirada da gráfica: 23/11/2026 17:00" });
  assert.match(m.texto, /Previsão de retirada da gráfica: 23\/11\/2026 17:00/);
  assert.match(decodeURIComponent(m.botoes[1][0].url), /Previsão de retirada da gráfica: 23\/11\/2026 17:00/);
  assert.doesNotMatch(decodeURIComponent(m.botoes[0][0].url), /Previsão/); // mensagem ao cliente não leva
  const n = avisoNovo({ card: { name: "Ana · 18 slots", desc: "Prazo limite para montar: 18/11/2026 17:00" }, coluna: "Montagem" });
  assert.match(n.texto, /Prazo limite para montar: 18\/11\/2026 17:00/);
});
test("dataHoraBR formata em Brasília", () => assert.equal(dataHoraBR(br("2026-11-27T13:00:00")), "27/11/2026 13:00"));

test("avisos não usam emojis e trazem a descrição do card sem linhas de controle", () => {
  const desc = "Cliente: Ana\nTelefone: +55 31 9\nSlots: 18\nPáginas: 1\nValor cobrado: R$ 30,00\nEntrou na coluna: 18/11/2026 11:26\nPrazo: 19/11/2026 17:00\nPrevisão de entrega: antiga\n\nAlterações:\n- Troca de arte";
  const m = avisoMovimento({ cardNome: "x", de: "Montagem", para: "Gráfica", card: { name: "Ana · 18 slots", desc }, previsao: "Prazo máximo de colagem: 27/11/2026 13:00" });
  assert.match(m.texto, /_Dados do pedido:_\n\*Cliente:\* Ana\n\*Slots:\* 18/);
  assert.match(m.texto, /\*Prazo máximo de colagem: 27\/11\/2026 13:00\*/);
  assert.match(m.texto, /- Troca de arte/);
  assert.doesNotMatch(m.texto, /Entrou na coluna|Prazo:|antiga/);
  const emoji = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}]/u;
  assert.doesNotMatch(m.texto, emoji);
  assert.doesNotMatch(avisoNovo({ card: { name: "A · 1 slots", desc }, coluna: "Novos pedidos" }).texto, emoji);
  const r = montarResumo({ listas: [{ id: "L", name: "Novos pedidos" }], cards: [{ id: "a", name: "A · 1 slots", desc: "", idList: "L" }], entradas: { a: br("2026-11-10T10:00:00") }, agoraMs: br("2026-11-18T10:00:00"), titulo: "Resumo" });
  assert.doesNotMatch(r, emoji);
  assert.match(m.botoes.at(-1)[0].url, /^https:\/\/wa\.me\/\?text=/);
});

import { linkWaGrupo } from "../src/avisos.js";
test("link do grupo cabe no limite de URL do Telegram mesmo com texto longo e acentuado", () => {
  const url = linkWaGrupo("Alteração ção ".repeat(400));
  assert.ok(url.length <= 1900, String(url.length));
  assert.match(url, /^https:\/\/wa\.me\/\?text=/);
});

test("mensagem interna: sem valor cobrado, com valor de colagem (páginas x 18 x 0,13)", () => {
  const { desc } = montarCard({ cliente: "Rodrigo Grupo", slots: 956, paginas: 54, valor: 1260 });
  const m = avisoMovimento({ cardNome: "x", de: "Montagem", para: "Gráfica", card: { name: "Rodrigo Grupo · 956 slots", desc }, previsao: "Prazo máximo de colagem: 25/11/2026 22:00" });
  assert.doesNotMatch(m.texto, /Valor cobrado|1\.?260/);
  assert.match(m.texto, /\*Valor de colagem:\* R\$ 126/);
  assert.match(desc, /Valor cobrado: R\$ 1260,00/); // o card mantém o valor cobrado
});

test("mensagem ao cliente nunca traz valores nem dados internos; aviso do grupo não traz telefone", () => {
  const { desc } = montarCard({ cliente: "Rodrigo Grupo", telefone: "+55 31 8825-0936", slots: 956, paginas: 54, valor: 1260, pastaUrl: "https://drive.google.com/x" });
  for (const para of ["Gráfica", "Retirada", "Pronto para entrega"]) {
    const m = avisoMovimento({ cardNome: "x", de: "A", para, card: { name: "Rodrigo Grupo · 956 slots", desc }, previsao: "Prazo máximo de colagem: 25/11/2026 22:00" });
    const cli = decodeURIComponent(m.botoes[0][0].url);
    assert.match(cli, /^https:\/\/wa\.me\/553188250936\?text=/);
    assert.doesNotMatch(cli.split("?text=")[1], /R\$|\d{3,}|valor|colagem|Pix|previs|prazo|slots/i);
    assert.doesNotMatch(m.texto, /\+55|8825/); // o grupo não vê o telefone
  }
});

import { paraTelegram } from "../src/avisos.js";
test("paraTelegram converte *negrito* e _itálico_ em HTML e escapa o resto", () => {
  assert.equal(paraTelegram("*PEDIDO MOVIDO:* Ana & Cia <x>\nDe _Montagem_ para _Gráfica_."), "<b>PEDIDO MOVIDO:</b> Ana &amp; Cia &lt;x&gt;\nDe <i>Montagem</i> para <i>Gráfica</i>.");
  assert.equal(paraTelegram("*Previsão de retirada da gráfica: 23/11/2026 17:00*"), "<b>Previsão de retirada da gráfica: 23/11/2026 17:00</b>");
});
test("paraTelegram não italiciza underscores de links nem asteriscos soltos", () => {
  const link = "https://drive.google.com/drive/folders/1AbC_dEf_GhI-jk";
  assert.equal(paraTelegram(`*Pasta do Drive:* ${link}`), `<b>Pasta do Drive:</b> ${link}`);
  assert.equal(paraTelegram("2 * 3 = 6 e snake_case_nome"), "2 * 3 = 6 e snake_case_nome");
});
test("mensagem completa do grupo usa só *negrito* e _itálico_ do WhatsApp, sem emojis e com o card em texto puro", () => {
  const { desc } = montarCard({ cliente: "Rodrigo Grupo", telefone: "+55 31 8825-0936", slots: 956, paginas: 54, valor: 1260, pastaUrl: "https://drive.google.com/drive/folders/1AbC_dEf", alteracoes: ["Troca de arte X"] });
  assert.doesNotMatch(desc, /[*]|(^|\s)_/); // a descrição do card (Markdown do Trello) não recebe formatação do WhatsApp
  const m = avisoMovimento({ cardNome: "x", de: "Montagem", para: "Gráfica", card: { name: "Rodrigo Grupo · 956 slots", desc }, previsao: "Previsão de retirada da gráfica: 23/11/2026 17:00" });
  assert.equal(m.texto, [
    "*PEDIDO MOVIDO:* Rodrigo Grupo · 956 slots",
    "De _Montagem_ para _Gráfica_.", "",
    "_Dados do pedido:_",
    "*Cliente:* Rodrigo Grupo", "*Slots:* 956", "*Páginas:* 54",
    "*Pasta do Drive:* https://drive.google.com/drive/folders/1AbC_dEf",
    "*Valor de colagem:* R$ 126",
    "*Previsão de retirada da gráfica: 23/11/2026 17:00*", "",
    "*Alterações:*", "- Troca de arte X",
  ].join("\n"));
});

import { vencimentoGrafica } from "../src/avisos.js";
test("vencimento do Trello (Google Agenda) só para a Gráfica: retirada prevista às 17h do 3º dia útil", () => {
  const info = lerCard({ id: "x", name: "A · 18 slots", desc: "" });
  assert.equal(vencimentoGrafica("Gráfica", br("2026-11-18T11:26:00"), info, br("2026-11-18T11:26:00")), new Date(br("2026-11-23T10:00:00")).toISOString()); // evento às 10h do dia da retirada
  assert.equal(vencimentoGrafica("Gráfica", br("2026-11-18T11:26:00"), info, br("2026-11-23T14:00:00")), new Date(br("2026-11-23T17:00:00")).toISOString()); // 10h já passou: usa a retirada prevista
  for (const c of ["Novos pedidos", "Montagem", "Retirada", "Colagem", "Finalizado"]) assert.equal(vencimentoGrafica(c, 0, info, 0), null, c);
});
test("vencimento respeita o Prazo manual (Cube LLJR: 19/11 17h)", () => {
  const { desc } = montarCard({ cliente: "L", slots: 86, entrouEm: "2026-11-18T11:26:00-03:00", prazo: "2026-11-19T17:00:00-03:00" });
  const info = lerCard({ id: "x", name: "L · 86 slots", desc });
  assert.equal(vencimentoGrafica("Gráfica", br("2026-11-18T11:26:00"), info, br("2026-11-18T12:00:00")), new Date(br("2026-11-19T10:00:00")).toISOString());
});

import { lembretesRetirada } from "../src/avisos.js";
test("lembretes de retirada: manhã do dia e véspera (próximo dia útil, pulando feriado e fim de semana)", () => {
  const listas = [{ id: "G", name: "Gráfica" }, { id: "M", name: "Montagem" }];
  const due = new Date(br("2026-11-23T10:00:00")).toISOString();
  const cards = [
    { id: "a", name: "Rodrigo Grupo · 956 slots", desc: "Páginas: 54\nPrevisão de retirada da gráfica: 23/11/2026 17:00", idList: "G", due, dueComplete: false },
    { id: "b", name: "Feito · 18 slots", desc: "", idList: "G", due, dueComplete: true },
    { id: "c", name: "Outra coluna · 18 slots", desc: "", idList: "M", due, dueComplete: false },
    { id: "d", name: "Outro dia · 18 slots", desc: "", idList: "G", due: new Date(br("2026-11-24T17:00:00")).toISOString(), dueComplete: false },
  ];
  const manha = lembretesRetirada({ listas, cards, agoraMs: br("2026-11-23T10:00:00"), periodo: "manha" });
  assert.match(manha, /\*RETIRADA NA GRÁFICA HOJE \(23\/11\)\*\n- Rodrigo Grupo · 956 slots · 54 páginas - viagem a partir das 10:00, retirada prevista 17:00/);
  assert.doesNotMatch(manha, /Feito|Outra coluna|Outro dia/);
  const vespera = lembretesRetirada({ listas, cards, agoraMs: br("2026-11-19T17:00:00"), periodo: "tarde" }); // qui 19 -> sex 20 é feriado -> seg 23
  assert.match(vespera, /PRÓXIMO DIA ÚTIL \(23\/11\)/);
  assert.match(vespera, /Planeje a viagem/);
  assert.equal(lembretesRetirada({ listas, cards, agoraMs: br("2026-11-18T17:00:00"), periodo: "tarde" }), null); // véspera de 19/11: nada
  assert.doesNotMatch(vespera, /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u);
});

test("edição do card (descrição/vencimento) não reinicia a entrada na coluna; só mudança de coluna conta", () => {
  const { desc } = montarCard({ cliente: "Cube", slots: 86, entrouEm: "2026-11-18T11:26:00-03:00", prazo: "2026-11-19T17:00:00-03:00" });
  const card = { id: "c1", name: "Cube · 86 slots", desc, dateLastActivity: "2026-11-19T00:30:00Z" };
  const edicao = { type: "updateCard", date: "2026-11-19T00:20:00Z", data: { card: { id: "c1" }, list: { id: "G" } } }; // sem listAfter
  const criacao = { type: "createCard", date: "2026-11-18T14:26:00Z", data: { card: { id: "c1" }, list: { id: "G" } } };
  assert.equal(entradasPorCard([edicao, criacao], [card]).c1, br("2026-11-18T11:26:00"));
  const info = lerCard(card);
  assert.equal(vencimentoGrafica("Gráfica", br("2026-11-18T11:26:00"), info, br("2026-11-18T22:16:00")), new Date(br("2026-11-19T10:00:00")).toISOString());
  const mover = { type: "updateCard", date: "2026-11-20T12:00:00Z", data: { card: { id: "c1" }, listAfter: { id: "R" }, listBefore: { id: "G" } } };
  assert.equal(entradasPorCard([mover, edicao, criacao], [card]).c1, Date.parse("2026-11-20T12:00:00Z"));
});
