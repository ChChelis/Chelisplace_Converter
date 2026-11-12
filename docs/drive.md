# Google Drive no site

A página fala com o Drive direto do navegador (login Google, API v3). Nada passa por servidor nosso; o token fica só na memória da página. O **Client ID** é público (não é senha) e é digitado no quadro "Google Drive" no alto da página (guardado só no navegador, nunca no código).

Pasta de pedidos: **Novo Processo Proxies** na raiz do Meu Drive; cada subpasta é um pedido (`<imagens>`, `pares/`, e `saida/` criada pelo site).

## O que o site faz no Drive
- **Checagem:** lê só os nomes dos arquivos. "Criar cópias" usa `files.copy` (feito no Drive, sem baixar nada). "Mover pares" usa `files.update` (muda de pasta, não apaga). Ambos só depois de confirmação dentro da página.
- **Montagem:** baixa as imagens (4 por vez), gera os PDFs no navegador e, com um clique e confirmação, envia para `<pedido>/saida`.
- Nunca apaga nada e nunca mexe fora de `Novo Processo Proxies`.

## Configurar (uma vez, ~10 min, na conta dona do Drive)
1. Entre em https://console.cloud.google.com e crie um projeto (ex.: "Chelisplace Pedidos").
2. **APIs e serviços → Biblioteca →** "Google Drive API" **→ Ativar**.
3. **Tela de permissão OAuth** (ou "Google Auth Platform → Branding/Público"):
   - Se o Drive é de uma conta **Workspace** (e-mail @chelisplace.com): público **Interno**. Sem aviso de "app não verificado".
   - Se for Gmail comum: público **Externo**, publicação **Em teste**, e adicione seu e-mail em **Usuários de teste** (até 100 pessoas; é assim que os beta entram).
4. **Acesso a dados (escopos):** adicionar `https://www.googleapis.com/auth/drive`.
5. **Clientes → Criar cliente → Aplicativo da Web.** Em **Origens JavaScript autorizadas** coloque (sem barra no fim):
   - `http://localhost:8780` (teste local)
   - `https://pedidos.chelisplace.com` (depois de publicar)
   - o endereço `https://….pages.dev` da Cloudflare, se usar.
   Não precisa de URI de redirecionamento.
6. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`).
7. Abra a página (`sh site/build.sh && python3 -m http.server 8780 -d site`, depois http://localhost:8780), abra "Google Drive", cole o ID e clique **Entrar com Google**. Em conta Externa/Em teste aparece "app não verificado": **Avançado → continuar** (é o seu próprio app).

## Limites e cuidados
- O escopo `drive` (acesso a todo o Drive) é o único que enxerga a pasta existente sem selecionar arquivo por arquivo. Para usuários beta, o ideal depois é trocar por `drive.file` + seletor do Google (cada usuário escolhe a pasta dele).
- Testado só com um Drive simulado (copiar, mover, enviar PDFs, reconferência). A 1ª conexão real pode revelar ajustes (por exemplo, o cabeçalho `Location` do envio em partes).
- Arquivos baixados do Drive são tratados como dados: só são lidos como imagem/XML.
