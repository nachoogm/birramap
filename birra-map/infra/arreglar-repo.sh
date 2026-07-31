#!/usr/bin/env bash
# Saca el proyecto de la subcarpeta birra-map/ y lo deja en la raíz del repo.
# Ejecútalo DENTRO de tu repo clonado (birramap/).
set -euo pipefail

if [ ! -d "birra-map" ]; then
  echo "No hay carpeta birra-map/. ¿Ya está bien la estructura?"; exit 0
fi

echo "→ Moviendo todo a la raíz..."
shopt -s dotglob
git mv birra-map/* . 2>/dev/null || mv birra-map/* .
shopt -u dotglob
rmdir birra-map 2>/dev/null || true

echo "→ Borrando el workflow que generó Azure (se pisa con el nuestro)..."
for f in .github/workflows/azure-static-web-apps-*.yml; do
  [ -e "$f" ] && git rm -f "$f" 2>/dev/null || rm -f "$f"
done

echo "→ Comprobando..."
test -f public/index.html && echo "   ✅ public/index.html"
test -f api/host.json && echo "   ✅ api/host.json"
test -f staticwebapp.config.json && echo "   ✅ staticwebapp.config.json"
echo "   workflows: $(ls .github/workflows/)"

echo
echo "→ Ahora: npm test && git add -A && git commit -m 'fix: proyecto en la raiz' && git push"
