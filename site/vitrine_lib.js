"use strict";
// Funções puras da Vitrine do cliente (usadas pela página de pedidos, pela subpágina /conferencia e nos testes).
const RE_ID_DRIVE = /\s*\(([A-Za-z0-9_-]{20,})\)/;

// Nome do arquivo -> legenda: tira extensão, marcas de cópia do navegador/Windows e o ID do Drive entre parênteses.
function legendaDoArquivo(nome) {
  let s = String(nome || "").replace(/\.[A-Za-z0-9]{2,5}$/, "");
  for (let i = 0; i < 4; i++) {
    const antes = s;
    s = s.replace(/\s*-\s*(Copia|Cópia|Copy)(\s*\(\d+\))?\s*$/i, "").replace(/\s*\(\d{1,3}\)\s*$/, "").replace(/\s*\([A-Za-z0-9_-]{20,}\)\s*$/, "");
    if (s === antes) break;
  }
  return s.trim();
}
const idNoNome = (nome) => { const m = String(nome || "").match(RE_ID_DRIVE); return m ? m[1] : ""; };

const ehImagem = (f) => /^image\//.test(f.mimeType || "") || /\.(png|jpe?g|webp|gif)$/i.test(f.name || "");

// Arquivos do Drive -> itens da vitrine. Cópias do mesmo ID do MPCFill (nome com o mesmo ID) aparecem uma vez.
function itensDaPasta(arquivos, { ocultarRepetidas = true } = {}) {
  let imgs = arquivos.filter(ehImagem);
  if (ocultarRepetidas) {  // do mesmo ID fica o arquivo de nome mais curto (o original, não a cópia)
    const melhor = new Map();
    for (const f of imgs) { const k = idNoNome(f.name); if (k && (!melhor.has(k) || f.name.length < melhor.get(k).name.length)) melhor.set(k, f); }
    imgs = imgs.filter((f) => { const k = idNoNome(f.name); return !k || melhor.get(k) === f; });
  }
  return imgs.sort((a, b) => a.name.localeCompare(b.name, "pt", { numeric: true })).map((f) => ({ id: f.id, nome: f.name, legenda: legendaDoArquivo(f.name) }));
}

const thumbUrl = (id, largura = 480) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${largura}`;

// Código da vitrine no endereço: /conferencia/<código> (ou ?v=<código>, útil em teste local).
function slugDoEndereco(pathname, search) {
  const q = new URLSearchParams(search || "").get("v");
  if (q) return q;
  const m = String(pathname || "").match(/\/conferencia\/([^/?#]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : "";
}

function quantoFalta(expiraMs, agoraMs) {
  const s = Math.max(0, Math.round((expiraMs - agoraMs) / 1000));
  if (s <= 0) return "expirada";
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

if (typeof module !== "undefined") module.exports = { legendaDoArquivo, idNoNome, itensDaPasta, thumbUrl, slugDoEndereco, quantoFalta, ehImagem };
