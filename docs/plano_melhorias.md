# Plano de melhorias do comparador (2026-10-16)

Base: 94 pares conferidos (35 do teste + 59 do pedido 1). Teste leave-one-out: 58 de 85 acertados.
Erros: 14 impressão diferente (muitos são "não existe a exata, escolhi a melhor"), 7 rodapé ilegível, 4 variante da mesma impressão.
No pedido real, com o modelo treinado só no teste: alta confiança 36/38, média 8/8, baixa 3/6; o usuário aceitou os 59.

## Já feito
- Regra do usuário: nunca deixar a carta de fora; pré-seleciona a mais próxima e alerta ("não tem, serve outra?").
- Desempate por resolução (maior dpi) entre candidatos de nota quase igual.
- Gabarito do pedido em `order/pedido1/gabarito.json`; o comparador treina com testset + pedidos.

## Ordem de ataque (impacto / esforço)
1. **Cortar a sangria antes de medir** (candidatas com proporção 0,735 têm margem): alinha carta inteira, arte, símbolo. Mede-se no leave-one-out. Esforço baixo.
2. **Preferência por uploader aprendida** das escolhas confirmadas (feature de fonte, calculada só no treino). Depois, a lista de casa do usuário entra como configuração. Esforço médio.
3. **Camada de regras do usuário** sobre a nota: moldura antes da arte, borda preta antes da branca, símbolo do set que existe antes de nenhum, Secret Lair exige exata. Depende de detectar moldura e borda de cada candidata (tags do MPCFill + imagem). Esforço médio/alto.
4. **Ampliar finalistas nas cartas de baixa confiança** (12 para 30) com OCR extra. Esforço baixo.
5. **Mensagem para o cliente** gerada a partir dos alertas, com os nomes e as impressões pedidas. Esforço baixo.
6. **Ambiente reproduzível** (`scripts/setup_env.sh`): venv com rapidocr, para não depender do container.
7. **Aprendizado contínuo**: cada pedido conferido vira gabarito (procedimento em `docs/regras_de_decisao.md`).

## Resultado do item 1 (corte da sangria)
Leave-one-out em 94 pares (85 com certo): pré-filtro grosso (só carta inteira) 39 -> 58; comparador completo 58 -> 59.
A maior parte do ganho dos sinais extras era compensar imagens desalinhadas. O que sobra nos erros é preferência (uploader, moldura entre variantes parecidas), não medida de imagem.
