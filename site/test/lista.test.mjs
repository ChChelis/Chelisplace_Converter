import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { lerLista, marcarFicha, listaParaBot, nomeParaBot, atribuir, tirarSlotsDoXml, idItem, sugerirPorNome, agruparPendentes } = createRequire(import.meta.url)("../lista.js");

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

const pend = (n, q = 1, set = "", cn = "") => Array.from({ length: q }, () => ({ nome: n, set, cn }));
const arq = (...n) => n.map((nome) => ({ nome }));

test("atribuir: o nome da carta no arquivo cobre o pendente; a sobra é o que não casou", () => {
  const r = atribuir(arq("tla-358-avatar-kyoshi.png", "004_The Legend of Kyoshi -- Avatar Kyoshi.png", "001_Dawn of Hope.png"), [...pend("Dawn of Hope"), ...pend("The Legend of Kyoshi")]);
  assert.deepEqual(r.sobra.map((x) => x.nome), ["tla-358-avatar-kyoshi.png"]);
  assert.equal(r.cobrem.length, 2);
  assert.deepEqual(r.grupos.map((g) => g.faltam), [0, 0]);
});
test("atribuir: 1 imagem para 9 iguais cobre 1 por padrão; o grupo mostra o que falta (3 grupos, como na tela real)", () => {
  const pendentes = [...pend("Mountain", 9, "j25", "90"), ...pend("Plains", 10, "pmps09", "1"), ...pend("Sram, Senior Edificer", 1, "mul", "6")];
  const r = atribuir(arq("001_Mountain.png", "002_Plains.png", "003_Sram, Senior Edificer.png"), pendentes);
  assert.deepEqual(r.grupos.map((g) => [g.preenchidos, g.faltam]), [[1, 8], [1, 9], [1, 0]]);
  assert.equal(r.sobra.length, 0);
});
test("atribuir: multiplicar (manual) e escolher outra imagem para outra carta", () => {
  const pendentes = [...pend("Mountain", 9, "j25", "90"), ...pend("Sol Ring", 1)];
  const itens = arq("001_Mountain.png", "foto.png");
  const man = [{ grupo: "Mountain|j25|90", arquivo: "001_Mountain.png", copias: 9 }, { grupo: "Sol Ring||", arquivo: "foto.png", copias: 1 }];
  const r = atribuir(itens, pendentes, man);
  assert.equal(r.cobrem.length, 10);                      // 9 cópias da Mountain + 1 foto
  assert.equal(r.cobrem.filter((x) => x.nome === "001_Mountain.png").length, 9);
  assert.deepEqual(r.grupos.map((g) => g.faltam), [0, 0]);
  assert.equal(r.sobra.length, 0);
});
test("atribuir: manual não passa de quantos slots faltam; bloqueio desfaz o automático", () => {
  const pendentes = pend("Mountain", 3, "j25", "90");
  assert.equal(atribuir(arq("a.png"), pendentes, [{ grupo: "Mountain|j25|90", arquivo: "a.png", copias: 99 }]).cobrem.length, 3);
  const b = atribuir(arq("001_Mountain.png"), pendentes, [], ["Mountain|j25|90|001_Mountain.png"]);
  assert.equal(b.cobrem.length, 0); assert.equal(b.sobra.length, 1);
});
test("atribuir: sem pendentes, tudo é sobra", () => {
  const r = atribuir(arq("a.png", "b.png"), []);
  assert.deepEqual([r.cobrem.length, r.sobra.length], [0, 2]);
});

const sub = (nome, caminho) => ({ nome, em: "sub", caminho, chave: `sub/${caminho}/${nome}`, rotulo: `${caminho}/${nome}`, opcional: true });
test("imagens de subpasta nunca entram sozinhas nem viram sobra; o mesmo nome em duas pastas é distinto", () => {
  const itens = [sub("Mountain.png", "loja1"), sub("Mountain.png", "loja2")];
  const r = atribuir(itens, pend("Mountain", 2, "j25", "90"));
  assert.equal(r.cobrem.length, 0); assert.equal(r.sobra.length, 0);       // opcionais: só entram se você escolher
  const m = atribuir(itens, pend("Mountain", 2, "j25", "90"), [{ grupo: "Mountain|j25|90", arquivo: "sub/loja2/Mountain.png", copias: 2 }]);
  assert.deepEqual(m.cobrem.map(idItem), ["sub/loja2/Mountain.png", "sub/loja2/Mountain.png"]);
});
test("troca de arte: tirar cópias de uma carta do XML (do último slot ao primeiro)", () => {
  const xml = `<order><fronts><card><id>AAA</id><slots>0,1,2</slots><name>X</name></card><card><id>BBB</id><slots>3</slots></card></fronts><backs><card><id>AAA</id><slots>0</slots></card></backs></order>`;
  assert.match(tirarSlotsDoXml(xml, "AAA", 2), /<id>AAA<\/id><slots>0<\/slots>/);
  const todas = tirarSlotsDoXml(xml, "AAA", 3);
  assert.doesNotMatch(todas.split("</fronts>")[0], /AAA/);                  // a carta sai de <fronts>
  assert.match(todas, /<backs><card><id>AAA<\/id>/);                       // <backs> não é mexido
  assert.match(todas, /<id>BBB<\/id><slots>3<\/slots>/);                   // outras cartas intactas
  assert.equal(tirarSlotsDoXml(xml, "ZZZ", 1), xml);
});
test("troca de arte: a mesma carta em dois cards (cópias separadas) perde do último para o primeiro", () => {
  const xml = `<order><fronts><card><id>A</id><slots>0,1</slots></card><card><id>A</id><slots>5,6</slots></card></fronts></order>`;
  const r = tirarSlotsDoXml(xml, "A", 3);
  assert.match(r, /<card><id>A<\/id><slots>0<\/slots><\/card>/);
  assert.equal((r.match(/<card>/g) || []).length, 1);
});

test("sugerirPorNome: reconhece pelo nome, com prefixo numérico, apóstrofo e subpasta; cada imagem serve a uma carta", () => {
  const pend = ["Blast Zone", "Hall of the Bandit Lord", "Rogue's Passage", "Snow-Covered Wastes", "Snow-Covered Wastes", "Carta Sem Imagem"].map((nome) => ({ nome, set: "x", cn: "1" })).concat([{ nome: "Blast Zone", set: "y", cn: "9" }]);   // Blast Zone em duas impressões
  const grupos = agruparPendentes(pend).map((g) => ({ ...g, faltam: g.qtd }));
  const sub = (nome) => ({ nome, chave: "sub/completar (corrigir sangria)/" + nome, opcional: true });
  const itens = [sub("001_Blast Zone.png"), sub("002_Hall of the Bandit Lord.png"), sub("015_Solemn Simulacrum.png"), sub("Rogues Passage.png"), sub("010_Snow-Covered Wastes.png"), sub("011_Snow-Covered Wastes (1).png")];
  const s = sugerirPorNome(itens, grupos), por = (n) => s.get(grupos.find((g) => g.nome === n).key);
  assert.equal(por("Blast Zone").nome, "001_Blast Zone.png");
  assert.equal(s.get(grupos.find((g) => g.nome === "Blast Zone" && g.set === "y").key).nome, "001_Blast Zone.png", "a mesma imagem serve a outra impressão da mesma carta");
  assert.equal(por("Hall of the Bandit Lord").nome, "002_Hall of the Bandit Lord.png");
  assert.equal(por("Rogue's Passage").nome, "Rogues Passage.png");
  assert.equal(por("Snow-Covered Wastes").nome, "010_Snow-Covered Wastes.png");   // o grupo é um só (×2): uma imagem multiplicada
  assert.equal(s.has(grupos.find((g) => g.nome === "Carta Sem Imagem").key), false);
  assert.ok(![...s.values()].some((i) => i.nome.includes("Solemn")), "não empurra Solemn Simulacrum para ninguém");
});

test("verso (_back): reconhece, não preenche a frente e vai logo depois dela", async () => {
  const { ehVerso, ordenarComVersos } = createRequire(import.meta.url)("../lista.js");
  assert.ok(ehVerso("001_Outland Liberator -- Frenzied Trapbreaker_back.png"));
  assert.ok(!ehVerso("004_Immerwolf.png") && !ehVerso("Black Lotus.png") && !ehVerso("Flashback.png"));
  // o verso vem ANTES da frente na ordem alfabética (numeração 004/005 trocada): não pode ocupar a vaga da frente
  const itens = [{ nome: "004_Tovolar's Huntmaster -- Tovolar's Packleader_back.png" }, { nome: "005_Tovolar's Huntmaster -- Tovolar's Packleader.png" }];
  const r = atribuir(itens, [{ nome: "Tovolar's Huntmaster", set: "mid", cn: "306" }]);
  assert.equal(r.cobrem.length, 1); assert.equal(r.cobrem[0].nome, itens[1].nome);
  assert.deepEqual(r.sobra, []); assert.deepEqual(r.versos.map((i) => i.nome), [itens[0].nome]);   // o verso é parte da carta: não é sobra, vai junto da frente
  assert.equal(sugerirPorNome(itens, agruparPendentes([{ nome: "Tovolar's Huntmaster" }])).get("Tovolar's Huntmaster||").nome, itens[1].nome);
  // ordem: A, B, verso de A -> A, verso de A, B
  const l = [{ nome: "001_A -- X.png" }, { nome: "002_B.png" }, { nome: "001_A -- X_back.png" }, { nome: "009_Z_back.png" }];
  assert.deepEqual(ordenarComVersos(l).map((i) => i.nome), ["001_A -- X.png", "001_A -- X_back.png", "002_B.png", "009_Z_back.png"]);
});

test("tirarSlotsDoXml na seção backs (troca de verso)", () => {
  const xml = "<order><fronts><card><id>F</id><slots>0</slots></card></fronts><backs><card><id>V</id><slots>0</slots></card></backs></order>";
  const r = tirarSlotsDoXml(xml, "V", 1, "backs");
  assert.match(r, /<backs><\/backs>/); assert.match(r, /<fronts><card><id>F<\/id>/);
  assert.equal(tirarSlotsDoXml(xml, "F", 1, "backs"), xml);   // id de frente não mexe nos versos
});

test("verso sem frente atribuída continua sendo extra (sobra)", () => {
  const r = atribuir([{ nome: "009_Zeta -- Y_back.png" }], [{ nome: "Outra", set: "mid", cn: "1" }]);
  assert.equal(r.sobra.length, 1); assert.equal(r.versos.length, 0);
});
