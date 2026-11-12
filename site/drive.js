"use strict";
// Google Drive no navegador: login por OAuth (Google Identity Services) e API v3.
// O token fica só na memória da página. O Client ID (público, não é segredo) é digitado na página e guardado no navegador.
const Drive = (() => {
  const ESCOPO = "https://www.googleapis.com/auth/drive";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const PASTA = "application/vnd.google-apps.folder";
  const NOME_RAIZ = "Novo Processo Proxies";
  let cliente = null, token = null, expira = 0, raizId = null;

  const q = (t) => String(t).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  function carregarGsi() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = Object.assign(document.createElement("script"), { src: "https://accounts.google.com/gsi/client", async: true });
      s.onload = res; s.onerror = () => rej(new Error("Não consegui carregar o login do Google (rede ou bloqueador)."));
      document.head.append(s);
    });
  }

  async function entrar(clientId, silencioso = false) {
    await carregarGsi();
    return new Promise((res, rej) => {
      cliente = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: ESCOPO,
        callback: (r) => {
          if (r.error) return rej(new Error("Login recusado: " + (r.error_description || r.error)));
          token = r.access_token; expira = Date.now() + (r.expires_in - 60) * 1000; res(true);
        },
        error_callback: (e) => rej(new Error("Login não concluído: " + (e.type || "erro"))),
      });
      cliente.requestAccessToken({ prompt: silencioso ? "" : "select_account" });
    });
  }
  const conectado = () => !!token;
  const sair = () => { if (token && window.google) google.accounts.oauth2.revoke(token, () => {}); token = null; raizId = null; };

  async function req(url, opts = {}) {
    if (!token) throw new Error("Entre com o Google primeiro.");
    if (Date.now() > expira && cliente) await new Promise((res, rej) => {
      cliente.callback = (r) => (r.error ? rej(new Error(r.error)) : ((token = r.access_token), (expira = Date.now() + (r.expires_in - 60) * 1000), res()));
      cliente.requestAccessToken({ prompt: "" });
    });
    for (let tentativa = 0; ; tentativa++) {
      const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + token } });
      if ((r.status === 429 || r.status >= 500) && tentativa < 4) { await new Promise((x) => setTimeout(x, 1000 * 2 ** tentativa)); continue; }
      if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r;
    }
  }

  async function listar(paiId, extra = "") {
    const saida = [];
    let pagina = "";
    do {
      const p = new URLSearchParams({
        q: `'${q(paiId)}' in parents and trashed=false${extra}`, pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
        fields: "nextPageToken,files(id,name,mimeType,size)",
      });
      if (pagina) p.set("pageToken", pagina);
      const j = await (await req(`${API}/files?${p}`)).json();
      saida.push(...j.files); pagina = j.nextPageToken || "";
    } while (pagina);
    return saida;
  }

  async function raiz() {
    if (raizId) return raizId;
    const p = new URLSearchParams({ q: `name='${q(NOME_RAIZ)}' and mimeType='${PASTA}' and trashed=false`, fields: "files(id,name)", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    const j = await (await req(`${API}/files?${p}`)).json();
    if (!j.files.length) throw new Error(`Não achei a pasta "${NOME_RAIZ}" no seu Drive.`);
    return (raizId = j.files[0].id);
  }

  const pedidos = async () => (await listar(await raiz(), ` and mimeType='${PASTA}'`)).sort((a, b) => a.name.localeCompare(b.name, "pt"));
  const baixar = async (id) => (await req(`${API}/files/${id}?alt=media&supportsAllDrives=true`)).arrayBuffer();

  async function criarPasta(nome, paiId) {
    const ja = (await listar(paiId, ` and name='${q(nome)}' and mimeType='${PASTA}'`))[0];
    if (ja) return ja.id;
    const r = await req(`${API}/files?supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nome, mimeType: PASTA, parents: [paiId] }) });
    return (await r.json()).id;
  }
  const copiar = async (id, nome, paiId) => (await (await req(`${API}/files/${id}/copy?supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nome, parents: [paiId] }) })).json()).id;
  const mover = (id, novoPai, velhoPai) => req(`${API}/files/${id}?addParents=${novoPai}&removeParents=${velhoPai}&supportsAllDrives=true`, { method: "PATCH" });

  // Envio em duas etapas (iniciar + enviar os bytes), serve para PDFs grandes.
  async function enviar(nome, bytes, paiId, tipo) {
    const ini = await req(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true`, {
      method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": tipo }, body: JSON.stringify({ name: nome, parents: [paiId] }),
    });
    const r = await req(ini.headers.get("Location"), { method: "PUT", headers: { "Content-Type": tipo }, body: bytes });
    return (await r.json()).id;
  }

  return { entrar, conectado, sair, listar, raiz, pedidos, baixar, criarPasta, copiar, mover, enviar, PASTA, NOME_RAIZ };
})();
