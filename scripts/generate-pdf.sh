#!/usr/bin/env sh
set -eu

for tool in pandoc xelatex mermaid-filter; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Falta la dependencia '$tool'. Instala Pandoc, XeLaTeX y mermaid-filter antes de generar el PDF." >&2
    exit 1
  fi
done

cd "$(dirname "$0")/.."
pandoc docs/PROYECTO.md \
  --from markdown \
  --filter mermaid-filter \
  --pdf-engine=xelatex \
  --toc \
  --number-sections \
  -V lang=es \
  -V geometry:margin=2.2cm \
  -V colorlinks=true \
  -o docs/PROYECTO.pdf
echo "PDF generado en docs/PROYECTO.pdf"
