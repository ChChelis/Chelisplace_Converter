# Aplicativo do bot (Bot Chelisplace)

Programa local para Windows: roda o bot inteiro no seu PC (lista → candidatos do MPCFill → conferência → XML → imagens), com a interface no estilo da Vitrine de Sets (carrossel, grade e triagem). Os dados ficam em `%LOCALAPPDATA%\ChelisplaceBot`.

## Usar
1. Baixe `Chelisplace_Simba_bot.zip` (artefato da compilação no GitHub, aba Actions), extraia e abra `Chelisplace_Simba (bot).exe` (dentro da pasta `Chelisplace_Simba (bot)`). O navegador abre sozinho no endereço local.
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

## Baixar, abrir e fechar o bot pela página (nov/2026)
- **Download:** a compilação (Actions → *Compilar o aplicativo*) agora também publica o zip como Release fixa `bot-latest`. A página (etapa 3) baixa de `https://github.com/ChChelis/Chelisplace_Converter/releases/download/bot-latest/Chelisplace_Simba_bot.zip` (repositório público). Cada compilação substitui essa Release.
- **Abrir pela página:** ao rodar, o `.exe` registra o endereço `chelisbot://` no Windows (HKCU, sem administrador). O botão “Abrir o bot” da página usa esse endereço (o navegador pergunta se pode abrir o app); abre com `cmd /c start /min`, ou seja, **minimizado**, e sem abrir a tela do bot no navegador (`--protocolo`). Na primeira vez é preciso abrir o `.exe` à mão uma vez, para o registro existir.
- **Janela:** o console abre minimizado e fecha junto com o bot. (Se um dia quisermos sem janela nenhuma, é preciso trocar `console=True` por `False` no spec e um ícone na bandeja para sair.)
- **Instância única:** ao iniciar, o bot pede ao que já estiver na porta 8781 para fechar (`POST /api/sair`, só aceito sem `Origin` ou de origens da página) e assume o lugar.
- **Fecha sozinho:** sem nenhuma chamada `/api` por 2 minutos (a página aberta e a tela do bot fazem uma a cada 20 s) e sem trabalho rodando, o bot encerra. Há 5 minutos de folga depois de iniciar. Variáveis de teste: `CHELIS_OCIOSO`, `CHELIS_FOLGA` (segundos). Na página, “Fechar o bot” também encerra.
