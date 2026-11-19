import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { montarEventos, idsDoCard, idEvento, assinarJwt, criarOuAtualizarEvento, removerEvento, agendaConfigurada } from "../src/agenda.js";
import { diaUtilAnterior17 } from "../src/prazos.js";

const br = (s) => Date.parse(s + "-03:00");

test("diaUtilAnterior17: retirada de segunda avisa na sexta; com feriado na sexta, na quinta", () => {
  assert.equal(diaUtilAnterior17(br("2026-11-30T10:00:00")), br("2026-11-27T17:00:00")); // seg 30 -> sex 27
  assert.equal(diaUtilAnterior17(br("2026-11-23T10:00:00")), br("2026-11-19T17:00:00")); // seg 23, sex 20 feriado -> qui 19
  assert.equal(diaUtilAnterior17(br("2026-11-19T10:00:00")), br("2026-11-18T17:00:00")); // qui 19 -> qua 18
});
test("id do evento só tem letras a-v e dígitos (regra do Google)", () => {
  const id = idEvento("6AFE2B3E71D4339CD994B7BC");
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.equal(id, "trello6afe2b3e71d4339cd994b7bc");
});
const cardRodrigo = { id: "6afe2b3e71d4339cd994b7bc", name: "Rodrigo Grupo · 956 slots", desc: "Cliente: Rodrigo Grupo\nTelefone: +55 31 8825-0936\nSlots: 956\nPáginas: 54\nValor cobrado: R$ 1260,00\nPrevisão de retirada da gráfica: 23/11/2026 17:00" };
test("montarEventos: viagem às 10h, aviso da véspera (17h do dia útil anterior) e aviso da manhã (8h), sem telefone nem valores", () => {
  const evs = montarEventos({ card: cardRodrigo, inicioMs: br("2026-11-23T10:00:00"), trelloUrl: "https://trello.com/c/abc", agoraMs: br("2026-11-18T22:00:00") });
  assert.equal(evs.length, 3);
  const [viagem, vespera, manha] = evs;
  assert.equal(viagem.summary, "Viagem: retirar pedido de Rodrigo Grupo na gráfica");
  assert.equal(viagem.start.dateTime, "2026-11-23T10:00:00-03:00");
  assert.equal(viagem.end.dateTime, "2026-11-23T11:00:00-03:00");
  assert.equal(vespera.start.dateTime, "2026-11-19T17:00:00-03:00"); // sexta 20 é feriado: avisa na quinta
  assert.match(vespera.summary, /próximo dia útil \(23\/11\) - Rodrigo Grupo/);
  assert.equal(manha.start.dateTime, "2026-11-23T08:00:00-03:00");
  assert.match(manha.summary, /hoje é dia de viagem à gráfica - Rodrigo Grupo/);
  assert.deepEqual(evs.map((e) => e.id), idsDoCard(cardRodrigo.id));
  for (const e of evs) { assert.match(e.id, /^[a-v0-9]{5,1024}$/); assert.deepEqual(e.reminders, { useDefault: true }); }
  assert.match(viagem.description, /Páginas: 54/); assert.match(viagem.description, /https:\/\/trello\.com\/c\/abc/);
  assert.doesNotMatch(JSON.stringify(evs), /8825|1260|Valor/);
});
test("montarEventos não cria avisos que já passaram", () => {
  const evs = montarEventos({ card: cardRodrigo, inicioMs: br("2026-11-23T10:00:00"), agoraMs: br("2026-11-23T09:00:00") });
  assert.equal(evs.length, 1); // 17h da véspera e 8h do dia já passaram
  assert.equal(montarEventos({ card: cardRodrigo, inicioMs: br("2026-11-23T10:00:00"), agoraMs: br("2026-11-23T07:00:00") }).length, 2);
});

async function chaveDeTeste() {
  const par = await webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", par.privateKey)).toString("base64").match(/.{1,64}/g).join("\n");
  return { par, sa: { client_email: "conta@projeto.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n` } };
}
test("JWT da conta de serviço: cabeçalho, corpo e assinatura RS256 válidos", async () => {
  const { par, sa } = await chaveDeTeste();
  const jwt = await assinarJwt(sa, 1000, "https://www.googleapis.com/auth/calendar.events");
  const [h, c, s] = jwt.split(".");
  const dec = (x) => JSON.parse(Buffer.from(x, "base64url").toString());
  assert.deepEqual(dec(h), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(dec(c), { iss: sa.client_email, scope: "https://www.googleapis.com/auth/calendar.events", aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 });
  assert.ok(await webcrypto.subtle.verify("RSASSA-PKCS1-v1_5", par.publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${c}`)));
});
test("sem segredos do Google o Worker ignora a agenda sem erro", async () => {
  assert.equal(agendaConfigurada({}), false);
  assert.deepEqual(await criarOuAtualizarEvento({}, { id: "x" }), { ignorado: "agenda não configurada" });
  assert.deepEqual(await removerEvento({}, "x"), { ignorado: "agenda não configurada" });
});
test("criar evento: POST; se já existe (409) faz PUT; remover ignora 404", async () => {
  const { sa } = await chaveDeTeste();
  const env = { GOOGLE_SA_JSON: JSON.stringify(sa), GOOGLE_CALENDAR_ID: "chelis@exemplo.com" };
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, op = {}) => {
    chamadas.push([op.method || "GET", String(url), op.headers?.authorization]);
    if (String(url).includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    if (op.method === "POST") return new Response("{}", { status: 409 });
    if (op.method === "PUT") return new Response("{}", { status: 200 });
    if (op.method === "DELETE") return new Response("{}", { status: 404 });
    return new Response("{}", { status: 500 });
  };
  try {
    assert.deepEqual(await criarOuAtualizarEvento(env, { id: "trelloabc" }), { ok: true });
    assert.deepEqual(await removerEvento(env, "ABC"), { ok: true });
  } finally { globalThis.fetch = original; }
  const g = chamadas.filter(([, u]) => u.includes("googleapis.com/calendar"));
  assert.deepEqual(g.map(([m]) => m), ["POST", "PUT", "DELETE", "DELETE", "DELETE"]); // remover apaga viagem, véspera e manhã
  assert.deepEqual(g.slice(2).map(([, u]) => u.split("/events/")[1]), ["trelloabc", "trelloabcv", "trelloabcm"]);
  assert.ok(g[0][1].includes(encodeURIComponent("chelis@exemplo.com")));
  assert.equal(g[0][2], "Bearer tok");
  });
