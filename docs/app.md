# Aplicativo do bot (Bot Chelisplace)

Programa local para Windows: roda o bot inteiro no seu PC (lista → candidatos do MPCFill → conferência → XML → imagens), com a interface no estilo da Vitrine de Sets (carrossel, grade e triagem). Os dados ficam em `%LOCALAPPDATA%\ChelisplaceBot`.

## Usar
1. Baixe `BotChelisplace-windows.zip` (artefato da compilação no GitHub, aba Actions), extraia e abra `BotChelisplace.exe`. O navegador abre sozinho no endereço local.
2. **+ Novo pedido**: cole a lista (`1 Sol Ring (C21) 263`, uma por linha). O processamento mostra o andamento; 100 cartas levam algumas dezenas de minutos.
3. Confira em **Carrossel** (teclado: setas, Enter aceita, N nenhum, D dúvida, Z desfaz), **Grade** ou **Triagem** (deslize: direita aceita, esquerda nenhum). **Ver alertas** mostra só o que merece olhar.
4. **XML e imagens**: gera o XML, baixa o XML e as imagens do Drive para a pasta que você escolher (uma por vez, com pausa), monta a mensagem para o cliente.
5. **Uploaders**: marque os de confiança; ganham ★ e um bônus de nota nos próximos pedidos.

## Exportar os usos e atualizar o bot
- **Usos → Exportar usos** gera `usos_AAAAMMDD_HHMM.json` (pedidos, decisões, uploaders, tempos). Mande para o Claude.
- Aqui: `venv/bin/python scripts/import_usage.py usos.json` cria `order/<nome>/` com o gabarito e baixa as imagens; depois `compare.py eval`, `calibrate.py` e `scripts/export_model.py` geram `app/modelo/modelo.json`.
- **Usos → Importar atualização** instala o `modelo.json` novo sem reinstalar. Mudança de código (não de modelo) pede nova compilação.
- Aceites em lote marcados "sem conferir" não entram no treino.

## Compilar
`.github/workflows/build-app.yml` (Actions → *Compilar o aplicativo* → Run workflow, ou tag `app-v*`): instala as dependências (`requirements-app.txt`), roda `pyinstaller app/build/chelis.spec`, testa o executável com `--selftest` e publica o zip. Desenvolvimento local: `python app/server.py --dev` (usa as pastas do repositório e treina o modelo).

## Limites conhecidos
- O executável é para Windows e é compilado pelo GitHub; a versão Linux foi testada aqui (`--selftest`, servidor, pipeline de 3 cartas), a de Windows ainda não.
- O pipeline roda uma carta por vez (no repositório usávamos 4 processos); pedidos grandes demoram mais.
- As fontes da interface vêm do Google Fonts; sem internet cai para fontes do sistema.
