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
  assert.match(texto, /Montagem → Gráfica/);
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
  assert.match(t, /Novo/); assert.doesNotMatch(t, /Velho/); assert.match(t, /Finalizado \(1\) — desde 09\/11/);
});
test("aviso de novo pedido", () => {
  const { texto, botoes } = avisoNovo({ card: { name: "Ana · 216 slots", desc: "" }, coluna: "Novos pedidos" });
  assert.match(texto, /Novo pedido: Ana · 216 slots/); assert.equal(botoes.length, 1);
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

import { previsaoEntrega, setLinha, textoPrevisao, dataHoraBR } from "../src/avisos.js";
test("previsão encadeia as etapas em horário útil, pulando fim de semana e feriado", () => {
  const info = lerCard({ id: "x", name: "A · 18 slots", desc: "" });
  const p = previsaoEntrega("Novos pedidos", br("2026-11-18T10:00:00"), info, br("2026-11-18T10:00:00"));
  assert.equal(p, br("2026-11-27T13:00:00")); // 18/11 Novos -> Montagem -> Gráfica (20/11 feriado) -> Retirada -> Colagem
});
test("previsão a partir da Gráfica respeita o Prazo manual e a Colagem por página (5 páginas = 90 slots)", () => {
  const { desc } = montarCard({ cliente: "L", slots: 86, paginas: 5, entrouEm: "2026-11-18T11:26:00-03:00", prazo: "2026-11-19T17:00:00-03:00" });
  const info = lerCard({ id: "x", name: "L · 86 slots", desc });
  assert.equal(info.slotsPrazo, 90);
  assert.equal(previsaoEntrega("Gráfica", br("2026-11-18T11:26:00"), info, br("2026-11-19T09:00:00")), br("2026-11-24T13:00:00"));
});
test("prazo da coluna atual vencido: etapas seguintes partem de agora", () => {
  const info = lerCard({ id: "x", name: "A · 18 slots", desc: "" });
  const agora = br("2026-12-01T10:00:00");
  const p = previsaoEntrega("Montagem", br("2026-11-18T10:00:00"), info, agora);
  assert.ok(p > agora);
});
test("sem previsão para colunas fora do fluxo; pronto/finalizado viram texto", () => {
  const info = lerCard({ id: "x", name: "A · 18 slots", desc: "" });
  assert.equal(previsaoEntrega("Qualquer", 0, info, 0), null);
  assert.equal(textoPrevisao("Pronto para entrega", 0, info, 0), "pronto para entrega");
  assert.equal(textoPrevisao("Finalizado", 0, info, 0), "entregue");
});
test("setLinha substitui ou acrescenta antes das Alterações", () => {
  assert.equal(setLinha("A: 1\nPrevisão de entrega: x", "Previsão de entrega", "y"), "A: 1\nPrevisão de entrega: y");
  assert.equal(setLinha("A: 1\n\nAlterações:\n- z", "Previsão de entrega", "y"), "A: 1\nPrevisão de entrega: y\n\nAlterações:\n- z");
  assert.equal(setLinha("A: 1", "B", "2"), "A: 1\nB: 2");
});
test("aviso de movimento e de novo pedido mostram a previsão (vai no texto encaminhado ao grupo)", () => {
  const m = avisoMovimento({ cardNome: "x", de: "Montagem", para: "Gráfica", card: { name: "Ana · 18 slots", desc: "Telefone: +55 31 9" }, previsao: "27/11/2026 13:00" });
  assert.match(m.texto, /Previsão de entrega: 27\/11\/2026 13:00/);
  assert.match(decodeURIComponent(m.botoes[1][0].url), /Previsão de entrega: 27\/11\/2026 13:00/);
  assert.doesNotMatch(decodeURIComponent(m.botoes[0][0].url), /Previsão/); // mensagem ao cliente não leva
  const n = avisoNovo({ card: { name: "Ana · 18 slots", desc: "Previsão de entrega: 27/11/2026 13:00" }, coluna: "Novos pedidos" });
  assert.match(n.texto, /Previsão de entrega: 27\/11\/2026 13:00/);
});
test("dataHoraBR formata em Brasília", () => assert.equal(dataHoraBR(br("2026-11-27T13:00:00")), "27/11/2026 13:00"));
