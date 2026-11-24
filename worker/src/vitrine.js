// Vitrine para o cliente: a página de pedidos publica uma lista de imagens (IDs do Drive + legendas) e o cliente
// abre /conferencia/<código> (página estática) que lê essa lista aqui. A lista vive num KV com prazo (some sozinha).
// Nada de segredo aqui: só IDs de arquivos do Drive que o Chelis compartilhou por link.
import { autorizado } from "./auth.js";

export const MAX_ITENS = 1000;
export const MIN_MINUTOS = 5;
export const MAX_MINUTOS = 7 * 24 * 60;
export const PADRAO_MINUTOS = 120;
const ID_DRIVE = /^[A-Za-z0-9_-]{10,100}$/;
const ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789"; // sem letras que se confundem (i l o 0 1)

const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

// "João – Torneio (Abril)" -> "joao-torneio-abril"
export function slugBase(titulo) {
  const s = semAcento(titulo).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s || "vitrine";
}

export function novoSlug(titulo, aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const b = aleatorio(8);
  let suf = "";
  for (let i = 0; i < 8; i++) suf += ALFABETO[b[i] % ALFABETO.length];
  return `${slugBase(titulo)}-${suf}`;
}

export const slugValido = (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(s || "")) && String(s).length <= 60;

// Valida o que a página mandou e devolve o que vai para o KV (ou {erro}).
export function validarPublicacao(b, agoraMs = Date.now()) {
  if (!b || typeof b !== "object") return { erro: "corpo inválido" };
  const titulo = String(b.titulo || "").trim().slice(0, 80);
  if (!titulo) return { erro: "faltou o título" };
  if (!Array.isArray(b.itens) || !b.itens.length) return { erro: "nenhuma imagem" };
  if (b.itens.length > MAX_ITENS) return { erro: `no máximo ${MAX_ITENS} imagens` };
  const itens = [];
  for (const i of b.itens) {
    const id = String(i && i.id || "");
    if (!ID_DRIVE.test(id)) return { erro: "ID de imagem inválido" };
    itens.push({ id, legenda: String(i.legenda || "").slice(0, 120) });
  }
  let min = Number(b.minutos);
  if (!Number.isFinite(min)) min = PADRAO_MINUTOS;
  min = Math.min(MAX_MINUTOS, Math.max(MIN_MINUTOS, Math.round(min)));
  return { titulo, itens, minutos: min, expira: agoraMs + min * 60000 };
}

const JSON_H = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };
const resp = (corpo, status, extra = {}) => new Response(JSON.stringify(corpo), { status, headers: { ...JSON_H, ...extra } });

// Rotas: POST /vitrine (publica), GET /vitrine/<slug> (público, para o cliente), DELETE /vitrine/<slug> (tira do ar).
export async function rotaVitrine(req, env, partes, { origens, cors, agora = Date.now(), aleatorio } = {}) {
  const publica = req.method === "GET" && partes.length === 2;
  const origem = req.headers.get("origin") || "";
  const h = publica ? { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" } : origens.includes(origem) ? { ...cors(origem), "access-control-allow-methods": "POST, DELETE, OPTIONS" } : null;

  if (req.method === "OPTIONS") {
    const o = origens.includes(origem) ? { ...cors(origem), "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" } : { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" };
    return new Response(null, { status: 204, headers: o });
  }
  if (!h) return resp({ erro: "origem não permitida" }, 403);
  if (!env.VITRINES) return resp({ erro: "KV VITRINES não ligado ao Worker (ver docs/worker_avisos.md)" }, 503, h);

  if (publica) {
    const slug = partes[1];
    if (!slugValido(slug)) return resp({ erro: "não existe" }, 404, h);
    const v = await env.VITRINES.get(slug, "json");
    if (!v) return resp({ erro: "não existe ou já expirou" }, 404, h);
    if (v.expira <= agora) return resp({ erro: "expirou", expirou: true }, 410, h);
    return resp({ titulo: v.titulo, itens: v.itens, expira: v.expira }, 200, h);
  }

  if (!(await autorizado(req, env))) return resp({ erro: "não autorizado: entre com o Google (conta autorizada)" }, 401, h);

  if (req.method === "POST" && partes.length === 1) {
    const corpo = await req.json().catch(() => null);
    const v = validarPublicacao(corpo, agora);
    if (v.erro) return resp({ erro: v.erro }, 400, h);
    const slug = novoSlug(v.titulo, aleatorio);
    const { minutos, ...guardar } = v;
    // o KV apaga sozinho ao fim do prazo (mínimo de 60 s); o GET também confere a data, por garantia
    await env.VITRINES.put(slug, JSON.stringify(guardar), { expirationTtl: Math.max(60, minutos * 60) });
    return resp({ slug, expira: v.expira }, 200, h);
  }

  if (req.method === "DELETE" && partes.length === 2) {
    if (!slugValido(partes[1])) return resp({ erro: "código inválido" }, 400, h);
    await env.VITRINES.delete(partes[1]);
    return resp({ ok: true }, 200, h);
  }
  return resp({ erro: "método inválido" }, 405, h);
}
