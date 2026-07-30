#!/usr/bin/env bash
# Arregla la Static Web App que YA tienes creada (birramap / rg-birramap).
set -euo pipefail
RG="${1:-rg-birramap}"; SWA="${2:-birramap}"

echo "→ Variables que faltan..."
az staticwebapp appsettings set -n "$SWA" -g "$RG" --setting-names \
  PURGE_KEY="$(openssl rand -hex 16)" \
  RETENTION_DAYS="180" -o none

echo "→ Configuración actual:"
az staticwebapp appsettings list -n "$SWA" -g "$RG" -o table

echo "→ Acuérdate de borrar el workflow duplicado que creó Azure:"
echo "   git rm .github/workflows/azure-static-web-apps-*.yml"
