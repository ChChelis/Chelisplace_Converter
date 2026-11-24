import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { legendaDoArquivo, idNoNome, itensDaPasta, thumbUrl, slugDoEndereco, quantoFalta } = createRequire(import.meta.url)("../vitrine_lib.js");

const ID = "1AbCdEfGhIjKlMnOpQrStUv";
test("legenda: tira extensão, ID do Drive e marcas de cópia", () => {
  assert.equal(legendaDoArquivo(`Sol Ring (${ID}).jpg`), "Sol Ring");
  assert.equal(legendaDoArquivo(`Sol Ring (${ID}) (1).png`), "Sol Ring");
  assert.equal(legendaDoArquivo(`Sol Ring (${ID}) - Copia (2).png`), "Sol Ring");
  assert.equal(legendaDoArquivo("Arte do João.png"), "Arte do João");
  assert.equal(legendaDoArquivo("Island (Full Art) (curto).jpg"), "Island (Full Art) (curto)");   // parênteses curtos não são ID
});
test("itensDaPasta: só imagens, ordem natural e cópias do mesmo ID uma vez", () => {
  const arq = [
    { id: "a", name: `B (${ID}).jpg`, mimeType: "image/jpeg" }, { id: "b", name: `B (${ID}) (1).jpg`, mimeType: "image/jpeg" },
    { id: "c", name: "A.png", mimeType: "image/png" }, { id: "d", name: "x.xml", mimeType: "text/xml" },
    { id: "e", name: "10.png", mimeType: "image/png" }, { id: "f", name: "9.png", mimeType: "image/png" },
  ];
  assert.deepEqual(itensDaPasta(arq).map((i) => i.id), ["f", "e", "c", "a"]);
  assert.equal(itensDaPasta(arq, { ocultarRepetidas: false }).length, 5);
  assert.equal(idNoNome(`B (${ID}).jpg`), ID);
});
test("endereço, miniatura e tempo restante", () => {
  assert.equal(slugDoEndereco("/conferencia/joao-abc23456", ""), "joao-abc23456");
  assert.equal(slugDoEndereco("/conferencia/joao-abc23456/", ""), "joao-abc23456");
  assert.equal(slugDoEndereco("/x", "?v=teste-1"), "teste-1");
  assert.equal(slugDoEndereco("/conferencia/", ""), "");
  assert.equal(thumbUrl("a/b", 200), "https://drive.google.com/thumbnail?id=a%2Fb&sz=w200");
  assert.equal(quantoFalta(90 * 60000, 0), "1 h 30 min");
  assert.equal(quantoFalta(61000, 0), "2 min");
  assert.equal(quantoFalta(0, 5), "expirada");
});
