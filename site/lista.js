"use strict";
// Lê listas coladas (texto exportado do Moxfield e do Archidekt, ou "2x Nome" simples). Sem rede: a impressão
// (set/número) só é guardada para o bot; quando a linha não traz set e número, a carta fica marcada como
// "adivinhada" (o bot usa a primeira edição em papel, a mais antiga). Funciona no navegador e no Node (testes).
const LINHA = /^\s*(\d+)\s*x?\s+(.+?)\s*$/i;
const FIM_EXTRA = /\s+(?:\[[^\]]*\]|\^[^^]*\^|\*[A-Za-z]\*)\s*$/;  // Archidekt: [Categoria] ^Tag^; Moxfield/Archidekt: *F* / *E*
const IMPRESSAO = /^(.*?)\s+\(([A-Za-z0-9]{2,6})\)\s+(\S+)$/;      // Nome (SET) 123

function lerLista(texto) {
  const cartas = [];
  for (const bruta of String(texto).split(/\r?\n/)) {
    const m = bruta.match(LINHA);
    if (!m) continue;  // cabeçalhos ("Sideboard", "Commander") e linhas em branco não têm quantidade
    let resto = m[2];
    while (FIM_EXTRA.test(resto)) resto = resto.replace(FIM_EXTRA, "");
    const imp = resto.match(IMPRESSAO);
    const nome = (imp ? imp[1] : resto).replace(/\s+\/{1,2}\s+/g, " // ").trim();
    if (!nome) continue;
    const carta = imp ? { nome, set: imp[2].toLowerCase(), numero: imp[3], adivinhada: false } : { nome, adivinhada: true };
    for (let i = 0; i < +m[1]; i++) cartas.push({ ...carta });
  }
  return cartas;
}

// Texto da ficha: se só algumas cartas não trazem set/número, elas levam "*"; se nenhuma traz, só a nota (sem "*" em tudo).
function marcarFicha(frentes) {
  const n = frentes.filter((c) => c.adivinhada).length;
  if (!n) return { frentes: frentes.map((c) => c.nome), nota: "" };
  const nota = "Impressão adivinhada" + (n < frentes.length ? " (cartas com *)" : "") + ": a lista não trazia set e número; vale a primeira edição em papel (a mais antiga), a conferir.";
  return { frentes: frentes.map((c) => c.nome + (c.adivinhada && n < frentes.length ? " *" : "")), nota };
}

// Texto no formato que o bot lê (uma linha "qtd Nome (SET) num" por carta distinta, na ordem em que aparecem).
function listaParaBot(frentes) {
  const linhas = new Map();
  for (const c of frentes) {
    const k = c.nome + "|" + (c.set || "") + "|" + (c.numero || "");
    const e = linhas.get(k) || { c, n: 0 };
    e.n++; linhas.set(k, e);
  }
  return [...linhas.values()].map(({ c, n }) => `${n} ${c.nome}${c.set ? ` (${c.set.toUpperCase()}) ${c.numero}` : ""}`).join("\n") + "\n";
}
// Nome de pedido aceito pelo bot: letras, números, "_" e "-" (até 60).
function nomeParaBot(txt) {
  return String(txt || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "pedido";
}

// Slots pendentes do bot (cartas sem imagem no MPCFill) × imagens extras da pasta.
// Grupos: cartas pendentes iguais (nome+set+número) ficam juntas ("Mountain ×9"). Uma imagem pode cobrir vários slots (multiplicar).
// Atribuições: as manuais (escolhidas pelo Chelis: {grupo, arquivo, copias}) valem primeiro; depois, automático pelo nome da carta no nome do
// arquivo (1 cópia por imagem). `bloqueios` ("grupo|arquivo") desfazem um automático. Sobra = imagem sem atribuição (pede incluir ou não).
const semAcento = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, " ").trim();
const chaveGrupo = (c) => [c.nome, c.set || "", c.cn || ""].join("|");
function agruparPendentes(pend) {
  const m = new Map();
  for (const c of pend) { const k = chaveGrupo(c); if (!m.has(k)) m.set(k, { key: k, nome: c.nome, set: c.set || "", cn: c.cn || "", qtd: 0 }); m.get(k).qtd++; }
  return [...m.values()];
}
function atribuir(itens, pendentes, manuais = [], bloqueios = []) {
  const grupos = agruparPendentes(pendentes).map((g) => ({ ...g, atrib: [], preenchidos: 0 }));
  const existe = new Set(itens.map((i) => i.nome)), usadoManual = new Set(), bloq = new Set(bloqueios);
  const por = new Map(grupos.map((g) => [g.key, g]));
  for (const m of manuais) {  // escolhas do Chelis
    const g = por.get(m.grupo); if (!g || !existe.has(m.arquivo)) continue;
    const n = Math.min(Math.max(1, m.copias | 0), g.qtd - g.preenchidos); if (n <= 0) continue;
    g.atrib.push({ arquivo: m.arquivo, copias: n, auto: false }); g.preenchidos += n; usadoManual.add(m.arquivo);
  }
  for (const it of itens) {  // automático: o nome da carta aparece no nome do arquivo
    if (usadoManual.has(it.nome)) continue;
    const n = semAcento(it.nome), g = grupos.find((g) => g.preenchidos < g.qtd && !bloq.has(g.key + "|" + it.nome) && semAcento(g.nome) && n.includes(semAcento(g.nome)));
    if (g) { g.atrib.push({ arquivo: it.nome, copias: 1, auto: true }); g.preenchidos++; }
  }
  const usados = new Set(grupos.flatMap((g) => g.atrib.map((a) => a.arquivo))), cobrem = [];
  for (const g of grupos) for (const a of g.atrib) for (let k = 0; k < a.copias; k++) cobrem.push(itens.find((i) => i.nome === a.arquivo));
  for (const g of grupos) g.faltam = g.qtd - g.preenchidos;
  return { grupos, cobrem, sobra: itens.filter((i) => !usados.has(i.nome)) };
}

if (typeof module !== "undefined") module.exports = { lerLista, marcarFicha, listaParaBot, nomeParaBot, agruparPendentes, atribuir, chaveGrupo };
