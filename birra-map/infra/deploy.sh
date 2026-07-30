#!/usr/bin/env bash
# BirraMap - despliegue completo en Azure. Uso: bash infra/deploy.sh
set -euo pipefail

RG="rg-birramap"; LOC="westeurope"; SA="stbirramap$RANDOM"; SWA="birramap"
REPO="https://github.com/nachoogm/birramap"

az group create -n $RG -l $LOC -o none
az storage account create -n $SA -g $RG -l $LOC --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false -o none
CONN=$(az storage account show-connection-string -n $SA -g $RG --query connectionString -o tsv)
az staticwebapp create -n $SWA -g $RG -l $LOC --sku Free --source $REPO --branch main --app-location "/public" --api-location "/api" --output-location "" --login-with-github -o none
az staticwebapp appsettings set -n $SWA -g $RG --setting-names STORAGE_CONNECTION_STRING="$CONN" PURGE_KEY="$(openssl rand -hex 16)" RETENTION_DAYS="180" -o none

echo "✅ https://$(az staticwebapp show -n $SWA -g $RG --query defaultHostname -o tsv)"
