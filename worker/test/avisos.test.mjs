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
  const entradas = { a: br("2026-11-17T10:00:00"), b: br("2026-11-01T10:00:00") };
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
