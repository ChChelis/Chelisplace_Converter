import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { lerLista, marcarFicha, listaParaBot, nomeParaBot, separarExtrasPuro } = createRequire(import.meta.url)("../lista.js");

test("Moxfield: quantidade, set e número; *F* ignorado; / vira //", () => {
  const r = lerLista("2 Avenging Hunter (CLB) 215\n1 Sol Ring (C21) 263 *F*\n1 Undercity / The Initiative (TCLB) 20");
  assert.equal(r.length, 4);
  assert.deepEqual(r[0], { nome: "Avenging Hunter", set: "clb", numero: "215", adivinhada: false });
  assert.deepEqual(r[2], { nome: "Sol Ring", set: "c21", numero: "263", adivinhada: false });
  assert.equal(r[3].nome, "Undercity // The Initiative");
});
test("Archidekt: [Categoria] e ^Tag^ saem do nome", () => {
  const r = lerLista("1x Sol Ring (c21) 263 [Ramp] ^Have,#37d67a^\n3x Island [Land]\n1x Lightning Bolt (2xm) 117 *F* [Burn]");
  assert.deepEqual(r.map((c) => c.nome), ["Sol Ring", "Island", "Island", "Island", "Lightning Bolt"]);
  assert.equal(r[0].numero, "263");
  assert.equal(r[1].adivinhada, true);
  assert.equal(r[4].set, "2xm");
});
test("só nome: adivinhada; cabeçalhos e linhas em branco são ignorados", () => {
  const r = lerLista("Commander\n1 Atraxa, Praetors' Voice\n\nSideboard\n2x Island");
  assert.equal(r.length, 3);
  assert.ok(r.every((c) => c.adivinhada && c.set === undefined));
});
test("ficha: asterisco só quando a lista é mista", () => {
  const mista = marcarFicha(lerLista("1 Sol Ring (C21) 263\n1 Island"));
  assert.deepEqual(mista.frentes, ["Sol Ring", "Island *"]);
  assert.match(mista.nota, /cartas com \*/);
  const toda = marcarFicha(lerLista("2 Island"));
  assert.deepEqual(toda.frentes, ["Island", "Island"]);
  assert.match(toda.nota, /adivinhada/);
  assert.equal(marcarFicha(lerLista("1 Sol Ring (C21) 263")).nota, "");
});

test("lista para o bot: agrupa cópias iguais, mantém set/número e a ordem", () => {
  const t = listaParaBot(lerLista("2 Island\n1 Sol Ring (C21) 263 *F*\n1 Island\n1x Sol Ring (c21) 263 [Ramp]\n1 Sol Ring"));
  assert.equal(t, "3 Island\n2 Sol Ring (C21) 263\n1 Sol Ring\n");
});
test("nome do pedido aceito pelo bot", () => {
  assert.equal(nomeParaBot("João da Silva / Deck #2"), "Joao_da_Silva_Deck_2");
  assert.equal(nomeParaBot(""), "pedido");
  assert.ok(/^[A-Za-z0-9_-]{1,60}$/.test(nomeParaBot("x".repeat(100) + "ção")));
});

test("extras: imagens que preenchem pendentes entram sempre; só a sobra é decisão", () => {
  const pend = ["Dawn of Hope", "Voice of Resurgence", "Lathiel, the Bounteous Dawn", "The Legend of Kyoshi"].map((nome) => ({ nome }));
  const arq = ["tla-358-avatar-kyoshi.png", "004_The Legend of Kyoshi -- Avatar Kyoshi.png", "003_Lathiel, the Bounteous Dawn.png", "002_Voice of Resurgence.png", "001_Dawn of Hope.png"].map((nome) => ({ nome }));
  const r = separarExtrasPuro(arq, pend);
  assert.deepEqual(r.sobra.map((x) => x.nome), ["tla-358-avatar-kyoshi.png"]);
  assert.equal(r.cobrem.length, 4);
});
test("extras: sem pendentes, tudo é sobra; nome diferente é coberto na ordem", () => {
  assert.equal(separarExtrasPuro([{ nome: "a.png" }], []).sobra.length, 1);
  const r = separarExtrasPuro([{ nome: "foto1.png" }, { nome: "foto2.png" }], [{ nome: "Sol Ring" }]);
  assert.deepEqual([r.cobrem.length, r.sobra.length], [1, 1]);
});
