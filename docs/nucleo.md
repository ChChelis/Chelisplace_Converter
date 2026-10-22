# Núcleo sem Photoshop (`nucleo/`)

Escrito a partir de `docs/referencia_processo.md`. Roda em qualquer máquina com Python 3 e Pillow; testes: `python -m unittest discover -s tests -t .`

| Módulo | Faz |
|---|---|
| `config.py` | Pasta de pedidos: `PEDIDOS_DIR`, ou `config.local.json` (fora do git), ou `G:\Meu Drive\Novo Processo Proxies` |
| `xml_mpc.py` | Lê/escreve o XML do MPC (recusa DOCTYPE/ENTITY) |
| `checagem.py` | /checagem: faltando, a duplicar, excesso, fora da lista, verso padrão, pares, XML dos faltantes. `analisar` só lê; `duplicar` só copia; `separar_pares` move e só deve ser chamada após confirmação. **Nada é apagado.** |
| `orcamento.py` | Fórmulas do /clientrundown (normal e foil), tabelas de preço no topo do arquivo |
| `imagem.py` | Qualquer origem → 816×1110, 300 dpi, RGB, PNG |
| `montagem.py` | Plano de páginas (raiz, preenchimento, pares no fim), página A3 3508×4961 com 18 slots, texto lateral, PDF |

CLI: `python -m nucleo checagem|orcamento|redimensionar|montar` (ver `python -m nucleo`).

## Suposições a validar lado a lado com o Photoshop
1. Reamostragem direta para 816×1110 (Lanczos), sem corte. A ação do PS pode divergir (dúvida 2 da referência; às vezes sai 1111 px).
2. Alfa achatado sobre branco; CMYK→RGB sem perfil ICC.
3. Rotação dos slots: 90° anti-horário (`montagem.GIRAR`); inverter se sair de cabeça para baixo.
4. Grade ideal (passo 1111 × 828,6) em vez dos ±3 px do PSD.
5. Texto lateral (nome e `XXX/TTT`): fonte padrão do Pillow, posição do PSD, rotacionado 90°. Falta fonte, corpo e cor (dúvida 7).
6. PDF em RGB, JPEG qualidade 30 (imita o preset leve). O PS exporta CMYK; ainda sem conversão de perfil. Página de ruído pesa ~4,6 MB; o PS gera 17–33 MB.
7. Pares nos últimos slots de trás para frente (o 1º par ocupa o último slot); ordem frente/verso a confirmar (dúvida 11).
8. Orçamento: arredonda para inteiro (meio sobe) o valor pago e a colagem; cálculo bate o exemplo da referência (120 slots → pago 155, lucro 41).
9. Duplicatas criadas pela checagem: `<nome> (copia N) (dup) (<ID>).ext`. Diferente da skill (que tira o ID): o ID fica para a reconferência funcionar.
