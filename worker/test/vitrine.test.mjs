import test from "node:test";
import assert from "node:assert/strict";
import { slugBase, novoSlug, slugValido, validarPublicacao, rotaVitrine } from "../src/vitrine.js";

const ORIGENS = ["https://pedidos.chelisplace.com"];
const cors = (o) => ({ "access-control-allow-origin": o, vary: "origin", "access-control-allow-headers": "authorization, content-type" });
const kv = () => { const m = new Map(), ttl = {}; return { m, ttl, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v, o) => { m.set(k, v); ttl[k] = o?.expirationTtl; }, delete: async (k) => { m.delete(k); } }; };
const pedir = (metodo, caminho, { origem, auth, corpo } = {}) => {
  const h = { get: (k) => ({ origin: origem || null, authorization: auth || null })[k.toLowerCase()] ?? null };
  return { method: metodo, headers: h, json: async () => corpo };
};
const IDS = [{ id: "1AbCdEfGhIjKlMnOpQrStUv", legenda: "Sol Ring" }];
const rota = (req, env, agora = 1000) => rotaVitrine(req, env, new URL("https://w" + req.__c).pathname.split("/").filter(Boolean), { origens: ORIGENS, cors, agora, aleatorio: (n) => new Uint8Array(n).map((_, i) => i * 3) });
const ir = (metodo, c, o, env, agora) => { const r = pedir(metodo, c, o); r.__c = c; return rota(r, env, agora); };

test("slug: sem acento, com sufixo aleatório, só caracteres seguros", () => {
  assert.equal(slugBase("João – Torneio (Abril)"), "joao-torneio-abril");
  assert.equal(slugBase("###"), "vitrine");
  const s = novoSlug("Cliente X");
  assert.match(s, /^cliente-x-[a-z0-9]{8}$/);
  assert.ok(slugValido(s));
  assert.ok(!slugValido("../x") && !slugValido("A-b") && !slugValido(""));
});

test("validarPublicacao: limites de prazo, id inválido, vazio", () => {
  assert.equal(validarPublicacao({ titulo: "x", itens: [] }).erro, "nenhuma imagem");
  assert.equal(validarPublicacao({ titulo: "", itens: IDS }).erro, "faltou o título");
  assert.equal(validarPublicacao({ titulo: "x", itens: [{ id: "a/b" }] }).erro, "ID de imagem inválido");
  assert.equal(validarPublicacao({ titulo: "x", itens: IDS, minutos: 1 }, 0).minutos, 5);
  assert.equal(validarPublicacao({ titulo: "x", itens: IDS, minutos: 99999999 }, 0).minutos, 7 * 24 * 60);
  const v = validarPublicacao({ titulo: "x", itens: IDS }, 1000);
  assert.equal(v.minutos, 120); assert.equal(v.expira, 1000 + 120 * 60000);
});

test("publicar exige origem da página e autorização; GET é público", async () => {
  const env = { VITRINES: kv(), PAGINA_SECRET: "segredo" };
  const corpo = { titulo: "Cliente X", itens: IDS, minutos: 30 };
  assert.equal((await ir("POST", "/vitrine", { corpo }, env)).status, 403);                                            // sem origem
  assert.equal((await ir("POST", "/vitrine", { origem: "https://evil.com", auth: "Bearer segredo", corpo }, env)).status, 403);
  assert.equal((await ir("POST", "/vitrine", { origem: ORIGENS[0], corpo }, env)).status, 401);                        // sem credencial
  const ok = await ir("POST", "/vitrine", { origem: ORIGENS[0], auth: "Bearer segredo", corpo }, env, 1000);
  assert.equal(ok.status, 200);
  const { slug, expira } = await ok.json();
  assert.equal(env.VITRINES.ttl[slug], 1800);
  assert.equal(expira, 1000 + 30 * 60000);

  const g = await ir("GET", "/vitrine/" + slug, {}, env, 2000);                                                         // público, sem origem nem senha
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("access-control-allow-origin"), "*");
  assert.equal(g.headers.get("x-robots-tag"), "noindex, nofollow");
  const d = await g.json();
  assert.equal(d.titulo, "Cliente X"); assert.equal(d.itens.length, 1);
});

test("expirou: 410 depois do prazo; some após DELETE; sem KV avisa", async () => {
  const env = { VITRINES: kv(), PAGINA_SECRET: "s" };
  const { slug, expira } = await (await ir("POST", "/vitrine", { origem: ORIGENS[0], auth: "Bearer s", corpo: { titulo: "a", itens: IDS, minutos: 5 } }, env, 0)).json();
  assert.equal((await ir("GET", "/vitrine/" + slug, {}, env, expira + 1)).status, 410);
  assert.equal((await ir("DELETE", "/vitrine/" + slug, { origem: ORIGENS[0] }, env)).status, 401);
  assert.equal((await ir("DELETE", "/vitrine/" + slug, { origem: ORIGENS[0], auth: "Bearer s" }, env)).status, 200);
  assert.equal((await ir("GET", "/vitrine/" + slug, {}, env, 1)).status, 404);
  assert.equal((await ir("GET", "/vitrine/..%2Fx", {}, env)).status, 404);
  assert.equal((await ir("GET", "/vitrine/abc-defghjkm", {}, {})).status, 503);
});
