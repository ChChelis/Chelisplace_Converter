# Regras de decisão do Chelis (extraídas da conferência de 2026-10-16)

Fonte: `testset/gabarito.json` (decisões dele em 35 pares) e as anotações que ele deixou.
As propostas do Claude (`testset/pairs.json`) coincidiram em 21 de 35.

## Ordem de preferência quando não há match 100%
1. **Impressão exata** (rodapé, moldura e arte iguais).
2. **Moldura tem prioridade sobre a arte.** "Se a pessoa pediu old frame, é mais fácil ela aceitar outra arte do que outro frame." (pf26_5)
3. **Borda preta é preferível à branca**, mesmo que a arte seja estendida. "Na falta da borda branca vai a preta, o inverso não pode rolar." (clb_215, 4ed_65)
4. **Impressões da The List** (símbolo de planeswalker no rodapé): aceita a versão normal da mesma carta. (plst_*)
5. **Showcase / moldura especial sem equivalente:** aceita a moldura normal com a mesma arte. (ltr_511, ltr_620)
6. **Texto moderno no lugar do antigo** é aceito quando a moldura e a arte batem (leb_162).

## Exceção: arte específica (Secret Lair e similares)
"Quando a pessoa pede uma arte específica assim de Secret Lair, tem que ser ela." Se não existir:
**gerar ALERTA** para falar com o cliente ("olha, não tem, serve outra?"), em vez de escolher outra arte. (sld_917, sld_2437, sld_2672, tle_315)

## Sem equivalente aceitável
Moldura antiga (4ª edição, MB2 futura, Alpha) sem candidato com a moldura certa: resultado "nenhum" (4ed_52, mb2_153, mb2_187, leb_270, pf25_13).

## Onde as propostas do Claude erraram
- Escolheu candidato exato quando o usuário preferia "nenhum": 4ed_52, mb2_153 (moldura antiga só parecida).
- Marcou "nenhum" onde o usuário aceita o parecido (13 pares): a tolerância dele é maior que a minha.
- Pesou a arte acima da moldura e a borda branca acima da preta.

## Regra técnica do XML (aprendida no pedido 2)
O editor do MPC Autofill usa o `<query>` para decidir o **tipo** da carta e só respeita o `<id>` se ele aparecer na busca desse tipo. Token precisa de `t:` no `<query>`; sem isso o editor busca entre cartas comuns e mostra outra carta ou "Card Not Found". O `<query>` deve ser o `searchq` que o MPCFill guarda na imagem (com prefixo de tipo).
Antes de entregar qualquer XML: `python3 -I scripts/verify_xml.py order/<pedido>/pedido.xml` (precisa ficar em 0 fora da busca).
