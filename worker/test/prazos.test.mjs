import test from "node:test";
import assert from "node:assert/strict";
import { somarUtil, prazoFinal, atrasado, GRAFICA } from "../src/prazos.js";

// helper: hora de Brasília -> epoch ms
const br = (s) => Date.parse(s + "-03:00");

test("1 expediente começando 10h termina 17h do mesmo dia", () => {
  assert.equal(prazoFinal("Novos pedidos", br("2026-11-18T10:00:00")), br("2026-11-18T17:00:00"));
});
test("entrada às 15h: 2h hoje, 5h amanhã -> 15h do dia seguinte", () => {
  assert.equal(prazoFinal("Montagem", br("2026-11-18T15:00:00")), br("2026-11-19T15:00:00"));
});
test("entrada antes do expediente conta a partir das 10h", () => {
  assert.equal(prazoFinal("Retirada", br("2026-11-18T08:00:00")), br("2026-11-18T17:00:00"));
});
test("entrada depois das 17h vai para o próximo dia útil", () => {
  assert.equal(prazoFinal("Retirada", br("2026-11-18T19:00:00")), br("2026-11-19T17:00:00"));
});
test("sexta à tarde pula o fim de semana", () => {
  // 2026-11-27 é sexta; 16h -> 1h sexta + 6h segunda (10h..16h)
  assert.equal(prazoFinal("Montagem", br("2026-11-27T16:00:00")), br("2026-11-30T16:00:00"));
});
test("gráfica: 3 dias úteis, 9h–18h (com feriado 20/11 no meio)", () => {
  assert.equal(prazoFinal("Gráfica", br("2026-11-18T09:00:00")), br("2026-11-23T18:00:00")); // 20/11 é feriado
});
test("colagem: 108 slots = 3h; 109 slots = 6h", () => {
  assert.equal(prazoFinal("Colagem", br("2026-11-18T10:00:00"), 108), br("2026-11-18T13:00:00"));
  assert.equal(prazoFinal("Colagem", br("2026-11-18T10:00:00"), 109), br("2026-11-18T16:00:00"));
  assert.equal(prazoFinal("Colagem", br("2026-11-18T10:00:00"), 0), br("2026-11-18T13:00:00"));
});
test("sem prazo para Pronto para entrega e Finalizado", () => {
  assert.equal(prazoFinal("Pronto para entrega", br("2026-11-18T10:00:00")), null);
  assert.equal(atrasado("Finalizado", 0, Date.now()), false);
});
test("atrasado só depois do prazo", () => {
  const e = br("2026-11-18T10:00:00");
  assert.equal(atrasado("Novos pedidos", e, br("2026-11-18T17:00:00")), false);
  assert.equal(atrasado("Novos pedidos", e, br("2026-11-18T17:01:00")), true);
});

test("feriado não conta: Montagem entrando 19/11 (qui) 15h passa por 20/11 (Consciência Negra) até seg 23/11", () => {
  // 2h na quinta (15h–17h) + 5h na segunda (10h–15h)
  assert.equal(prazoFinal("Montagem", br("2026-11-19T15:00:00")), br("2026-11-23T15:00:00"));
});
test("gráfica pula feriado: entrada qua 18/11 9h, 3 dias úteis (qua, qui, seg) -> seg 23/11 18h", () => {
  assert.equal(prazoFinal("Gráfica", br("2026-11-18T09:00:00")), br("2026-11-23T18:00:00"));
});
test("entrada em feriado começa no próximo dia útil", () => {
  assert.equal(prazoFinal("Retirada", br("2026-11-20T11:00:00")), br("2026-11-23T17:00:00"));
});
