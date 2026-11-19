// Autorização do /card pela conta Google da página (a mesma do Drive), no lugar de uma senha digitada a cada pedido.
const PADRAO = "@chelisplace.com";

// lista: "@dominio.com, pessoa@exemplo.com" (variável opcional EMAILS_PERMITIDOS); padrão: o domínio do Chelis.
export function emailPermitido(email, lista = PADRAO) {
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) return false;
  return String(lista || PADRAO).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
    .some((x) => (x.startsWith("@") ? e.endsWith(x) : e === x));
}

// Pergunta ao Google de quem é o token (a página só tem o escopo do Drive, que devolve o e-mail em about.user).
export async function emailDoTokenGoogle(token) {
  const r = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d?.user?.emailAddress || null;
}

// Aceita a senha da página (PAGINA_SECRET) ou um token Google de e-mail permitido.
export async function autorizado(req, env) {
  const h = req.headers.get("authorization") || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!bearer) return false;
  if (env.PAGINA_SECRET && bearer === env.PAGINA_SECRET) return true;
  const email = await emailDoTokenGoogle(bearer).catch(() => null);
  return emailPermitido(email, env.EMAILS_PERMITIDOS);
}
