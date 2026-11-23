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

if (typeof module !== "undefined") module.exports = { lerLista, marcarFicha };
