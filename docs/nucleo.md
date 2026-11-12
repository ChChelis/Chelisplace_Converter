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

## Estado depois da validação (docs/validacao_montagem.md)
Validado lado a lado com o Photoshop (pedido A, 108 slots): imagens com diferença média 1,8/255, posição e rotação certas. Ajustes feitos a partir do relatório:
- **PDF em qualidade 100** (JPEG sem subamostragem de cor), pedido do Chelis: é para impressão. Uma página pesa ~25 a 35 MB, como as do Photoshop (27–29 MB).
- **Níveis do PSD** aplicados (saída 15–255, gama 1,03).
- **Texto lateral:** nome 20 pt ancorado embaixo (y 4437), progresso 24 pt centralizado (y 4697), sem zeros à esquerda (`18/108`). Fonte: Consolas se existir (Windows); no navegador cai na fonte padrão do Pillow, então o tamanho do texto ainda difere um pouco.
- **Pares** consecutivos no fim, cada frente seguida do verso, na ordem do XML (na página, o XML é opcional na aba Montagem; sem ele a ordem é alfabética).

## Ainda em aberto
1. **Proporção das imagens:** o Photoshop mantém largura 816 e deixa a altura variar (1108–1140); o núcleo força 816×1110 (todas as cartas com tamanho idêntico). **Decidido pelo Chelis (2026-11-12):** seguir com 816×1110 e comparar, em teste na gráfica, uma folha do núcleo com uma do processo antigo; ajustar depois se houver diferença.
2. Perfil de cor RGB→CMYK: o PDF do Photoshop é CMYK sem perfil; o do núcleo é RGB.
3. Fonte Consolas não existe no navegador.
