#!/bin/sh
# Copia o núcleo Python para dentro do site (o Pyodide o carrega daqui). Rode antes de publicar.
set -e
cd "$(dirname "$0")"
rm -rf nucleo
mkdir nucleo
cp ../nucleo/*.py nucleo/
cp -r ../nucleo/fontes nucleo/fontes
ls nucleo/*.py | xargs -n1 basename > nucleo/lista.txt
# carimbo de versão (a página mostra e avisa quando sai uma nova)
V="${CF_PAGES_COMMIT_SHA:-${WORKERS_CI_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo dev)}}"
printf '{"versao":"%s","data":"%s"}\n' "$(printf %s "$V" | cut -c1-7)" "$(date -u +%Y-%m-%d\ %H:%M)" > versao.json
