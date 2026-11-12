#!/bin/sh
# Copia o núcleo Python para dentro do site (o Pyodide o carrega daqui). Rode antes de publicar.
set -e
cd "$(dirname "$0")"
rm -rf nucleo
mkdir nucleo
cp ../nucleo/*.py nucleo/
ls nucleo/*.py | xargs -n1 basename > nucleo/lista.txt
