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
const semAcento = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’`´]/g, "").replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, " ").trim();
// Verso de dupla-face pelo nome do arquivo: "001_Nome -- Outro_back.png". A base (sem número e sem "_back") liga o verso à sua frente.
const ehVerso = (nome) => /[_\s-]back$/i.test(String(nome).replace(/\.[a-z0-9]+$/i, "").trim());
const baseVerso = (nome) => semAcento(String(nome).replace(/\.[a-z0-9]+$/i, "").replace(/[_\s-]back$/i, "")).replace(/^\d+\s+/, "");
// Põe cada verso (_back) logo depois da sua frente (mesma base de nome) na lista; verso sem frente na lista fica onde estava. Frente seguida do verso, como nos pares.
function ordenarComVersos(lista) {
  const versos = lista.filter((i) => ehVerso(i.nome)), frentes = lista.filter((i) => !ehVerso(i.nome));
  const usado = new Set(), saida = [];
  for (const f of lista) {
    if (ehVerso(f.nome)) continue;
    saida.push(f);
    const b = baseVerso(f.nome);
    for (const v of versos) if (!usado.has(v) && b && baseVerso(v.nome) === b) { usado.add(v); saida.push(v); }
  }
  return [...saida, ...versos.filter((v) => !usado.has(v))];
}
const idItem = (i) => i.chave || i.nome;  // imagens de subpastas têm chave própria (o mesmo nome pode existir em mais de uma pasta)
const chaveGrupo = (c) => [c.nome, c.set || "", c.cn || ""].join("|");
function agruparPendentes(pend) {
  const m = new Map();
  for (const c of pend) { const k = chaveGrupo(c); if (!m.has(k)) m.set(k, { key: k, nome: c.nome, set: c.set || "", cn: c.cn || "", qtd: 0 }); m.get(k).qtd++; }
  return [...m.values()];
}
function atribuir(itens, pendentes, manuais = [], bloqueios = []) {
  const grupos = agruparPendentes(pendentes).map((g) => ({ ...g, atrib: [], preenchidos: 0 }));
  const existe = new Set(itens.map(idItem)), usadoManual = new Set(), bloq = new Set(bloqueios);
  const por = new Map(grupos.map((g) => [g.key, g]));
  for (const m of manuais) {  // escolhas do Chelis
    const g = por.get(m.grupo); if (!g || !existe.has(m.arquivo)) continue;
    const n = Math.min(Math.max(1, m.copias | 0), g.qtd - g.preenchidos); if (n <= 0) continue;
    g.atrib.push({ arquivo: m.arquivo, copias: n, auto: false }); g.preenchidos += n; usadoManual.add(m.arquivo);
  }
  for (const it of itens) {  // automático: o nome da carta aparece no nome do arquivo (imagens opcionais, de subpastas, só entram se você escolher)
    if (it.opcional || ehVerso(it.nome) || usadoManual.has(idItem(it))) continue;   // _back é verso: nunca preenche a frente
    const n = semAcento(it.nome), g = grupos.find((g) => g.preenchidos < g.qtd && !bloq.has(g.key + "|" + idItem(it)) && semAcento(g.nome) && n.includes(semAcento(g.nome)));
    if (g) { g.atrib.push({ arquivo: idItem(it), copias: 1, auto: true }); g.preenchidos++; }
  }
  const usados = new Set(grupos.flatMap((g) => g.atrib.map((a) => a.arquivo))), cobrem = [];
  for (const g of grupos) for (const a of g.atrib) for (let k = 0; k < a.copias; k++) cobrem.push(itens.find((i) => idItem(i) === a.arquivo));
  for (const g of grupos) g.faltam = g.qtd - g.preenchidos;
  return { grupos, cobrem, sobra: itens.filter((i) => !usados.has(idItem(i)) && !i.opcional) };
}

// Sugestão pelo NOME, para o seletor e para "confirmar todas": para cada carta pendente que ainda falta, a imagem (de qualquer pasta, inclusive subpastas e completar/)
// cujo nome tem o nome da carta ("001_Blast Zone.png", "Rogues Passage" = "Rogue's Passage"). Vence o nome mais parecido (igual > mais curto); uma imagem não serve a cartas de nomes diferentes.
function sugerirPorNome(itens, grupos) {
  const sem = (n) => semAcento(n).replace(/^\d+\s+/, "");   // tira o "001_" do começo
  const usado = new Map(), sug = new Map();   // imagem -> nome da carta que a levou
  for (const g of grupos) {
    const alvo = semAcento(g.nome); if (!alvo || g.faltam <= 0) continue;
    const cand = itens.filter((i) => !ehVerso(i.nome) && (!usado.has(idItem(i)) || usado.get(idItem(i)) === alvo) && sem(i.nome).includes(alvo))   // a mesma imagem serve a impressões diferentes da mesma carta, não a cartas de nomes diferentes
      .sort((a, b) => (sem(a.nome) === alvo ? 0 : 1) - (sem(b.nome) === alvo ? 0 : 1) || (a.opcional ? 1 : 0) - (b.opcional ? 1 : 0) || sem(a.nome).length - sem(b.nome).length);
    if (cand[0]) { sug.set(g.key, cand[0]); usado.set(idItem(cand[0]), alvo); }
  }
  return sug;
}

// Troca de arte: tira `k` cópias (slots) da carta `id` do <fronts> do XML (do último slot para o primeiro). Sem mais slots, a carta sai do XML.
function tirarSlotsDoXml(txt, id, k, secao = "fronts") {   // secao "backs": troca de verso (dupla-face)
  return txt.replace(new RegExp(`<${secao}>([\\s\\S]*?)<\\/${secao}>`), (m, corpo) => {
    const cartas = [...corpo.matchAll(/<card>[\s\S]*?<\/card>/g)].map((x) => ({ texto: x[0], index: x.index })), novos = cartas.map((c) => c.texto);
    let resta = k;
    for (let i = cartas.length - 1; i >= 0 && resta > 0; i--) {
      const mid = cartas[i].texto.match(/<id>\s*([^<\s]+)\s*<\/id>/);
      if (!mid || mid[1] !== id) continue;
      const ms = cartas[i].texto.match(/<slots>([^<]*)<\/slots>/), lista = ms ? ms[1].split(",").map((s) => s.trim()).filter(Boolean) : ["0"];
      const tira = Math.min(resta, lista.length); resta -= tira;
      const nova = lista.slice(0, lista.length - tira);
      novos[i] = nova.length ? cartas[i].texto.replace(/<slots>[^<]*<\/slots>/, `<slots>${nova.join(",")}</slots>`) : null;
    }
    let saida = "", pos = 0;
    cartas.forEach((c, i) => { saida += corpo.slice(pos, c.index) + (novos[i] === null ? "" : novos[i]); pos = c.index + c.texto.length; });
    return `<${secao}>` + saida + corpo.slice(pos) + `</${secao}>`;
  });
}

if (typeof module !== "undefined") module.exports = { ehVerso, baseVerso, ordenarComVersos, sugerirPorNome, semAcento, lerLista, marcarFicha, listaParaBot, nomeParaBot, agruparPendentes, atribuir, chaveGrupo, idItem, tirarSlotsDoXml };
