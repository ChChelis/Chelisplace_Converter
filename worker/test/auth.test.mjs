import test from "node:test";
import assert from "node:assert/strict";
import { emailPermitido, autorizado } from "../src/auth.js";

const req = (auth) => ({ headers: { get: (k) => (k.toLowerCase() === "authorization" ? auth : null) } });
const comGoogle = async (resposta, fn) => {
  const original = globalThis.fetch; const chamadas = [];
  globalThis.fetch = async (url, op) => { chamadas.push([String(url), op?.headers?.authorization]); return resposta; };
  try { return [await fn(), chamadas]; } finally { globalThis.fetch = original; }
};

test("emailPermitido: padrão é o domínio do Chelis; lista aceita domínios e e-mails", () => {
  assert.equal(emailPermitido("contato@chelisplace.com"), true);
  assert.equal(emailPermitido("alguem@gmail.com"), false);
  assert.equal(emailPermitido("x@evilchelisplace.com"), false);
  assert.equal(emailPermitido("pessoa@exemplo.com", "@chelisplace.com, pessoa@exemplo.com"), true);
  assert.equal(emailPermitido("", "@chelisplace.com"), false);
  assert.equal(emailPermitido("contato@chelisplace.com.evil.com"), false);
});
test("autorizado: senha da página vale sem consultar o Google", async () => {
  const [ok, chamadas] = await comGoogle(new Response("{}"), () => autorizado(req("Bearer minhasenha"), { PAGINA_SECRET: "minhasenha" }));
  assert.equal(ok, true); assert.equal(chamadas.length, 0);
});
test("autorizado: token Google de e-mail do domínio vale; de outro e-mail não", async () => {
  const [ok, chamadas] = await comGoogle(new Response(JSON.stringify({ user: { emailAddress: "contato@chelisplace.com" } })), () => autorizado(req("Bearer tokGoogle"), { PAGINA_SECRET: "s" }));
  assert.equal(ok, true); assert.ok(chamadas[0][0].includes("drive/v3/about")); assert.equal(chamadas[0][1], "Bearer tokGoogle");
  const [no] = await comGoogle(new Response(JSON.stringify({ user: { emailAddress: "intruso@gmail.com" } })), () => autorizado(req("Bearer tokGoogle"), { PAGINA_SECRET: "s" }));
  assert.equal(no, false);
});
test("autorizado: sem cabeçalho, token inválido ou Google fora do ar negam", async () => {
  assert.equal(await autorizado(req(null), { PAGINA_SECRET: "s" }), false);
  const [a] = await comGoogle(new Response("{}", { status: 401 }), () => autorizado(req("Bearer ruim"), { PAGINA_SECRET: "s" }));
  assert.equal(a, false);
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error("rede"); };
  try { assert.equal(await autorizado(req("Bearer x"), {}), false); } finally { globalThis.fetch = original; }
});
