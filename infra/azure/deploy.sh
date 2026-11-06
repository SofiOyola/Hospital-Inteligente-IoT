#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${AZURE_SUBSCRIPTION_ID:-}" || -z "${RESOURCE_GROUP:-}" || -z "${NAME_PREFIX:-}" \
  || -z "${POSTGRES_ADMIN_PASSWORD:-}" || -z "${INFLUX_TOKEN:-}" || -z "${GRAFANA_PASSWORD:-}" \
  || -z "${CONTROL_TOKEN:-}" || -z "${MQTT_PASSWORD:-}" ]]; then
  echo "Set AZURE_SUBSCRIPTION_ID, RESOURCE_GROUP, NAME_PREFIX, POSTGRES_ADMIN_PASSWORD, INFLUX_TOKEN, GRAFANA_PASSWORD, CONTROL_TOKEN and MQTT_PASSWORD." >&2
  exit 1
fi

command -v az >/dev/null || { echo "Install Azure CLI first." >&2; exit 1; }
command -v jq >/dev/null || { echo "Install jq first." >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOCATION="${LOCATION:-eastus2}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
ENABLE_DIGITAL_TWINS="${ENABLE_DIGITAL_TWINS:-false}"
ENABLE_APP_SERVICE="${ENABLE_APP_SERVICE:-false}"
DNS_ZONE_NAME="${DNS_ZONE_NAME:-}"
POSTGRES_ADMIN_LOGIN="${POSTGRES_ADMIN_LOGIN:-hospitaladmin}"
MQTT_USERNAME="${MQTT_USERNAME:-hospital-iot}"
AZURE_MAPS_KEY="${AZURE_MAPS_KEY:-}"

case "$ENABLE_DIGITAL_TWINS" in true|false) ;; *) echo "ENABLE_DIGITAL_TWINS must be true or false." >&2; exit 1 ;; esac
case "$ENABLE_APP_SERVICE" in true|false) ;; *) echo "ENABLE_APP_SERVICE must be true or false." >&2; exit 1 ;; esac

az account set --subscription "$AZURE_SUBSCRIPTION_ID"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name hospital-iot-registry \
  --template-file "$ROOT_DIR/infra/azure/registry.bicep" \
  --parameters namePrefix="$NAME_PREFIX" location="$LOCATION" \
  --output none

REGISTRY_NAME="$(az deployment group show \
  --resource-group "$RESOURCE_GROUP" \
  --name hospital-iot-registry \
  --query properties.outputs.registryName.value \
  --output tsv)"

az acr build --registry "$REGISTRY_NAME" --image "hospital-backend:$IMAGE_TAG" "$ROOT_DIR/backend"
az acr build --registry "$REGISTRY_NAME" --image "hospital-frontend:$IMAGE_TAG" "$ROOT_DIR/frontend"
az acr build --registry "$REGISTRY_NAME" --image "hospital-mqtt:$IMAGE_TAG" "$ROOT_DIR/mqtt"
az acr build --registry "$REGISTRY_NAME" --image "hospital-influxdb:$IMAGE_TAG" "$ROOT_DIR/influxdb"
az acr build --registry "$REGISTRY_NAME" --image "hospital-grafana:$IMAGE_TAG" "$ROOT_DIR/grafana"
az acr build --registry "$REGISTRY_NAME" --image "hospital-analytics-ai:$IMAGE_TAG" "$ROOT_DIR/analytics-ai"

PARAM_FILE="$(mktemp)"
trap 'rm -f -- "$PARAM_FILE"' EXIT
chmod 600 "$PARAM_FILE"
jq -n \
  --arg namePrefix "$NAME_PREFIX" \
  --arg location "$LOCATION" \
  --arg registryName "$REGISTRY_NAME" \
  --arg imageTag "$IMAGE_TAG" \
  --arg postgresAdminLogin "$POSTGRES_ADMIN_LOGIN" \
  --arg postgresAdminPassword "$POSTGRES_ADMIN_PASSWORD" \
  --arg influxToken "$INFLUX_TOKEN" \
  --arg grafanaPassword "$GRAFANA_PASSWORD" \
  --arg controlToken "$CONTROL_TOKEN" \
  --arg mqttUsername "$MQTT_USERNAME" \
  --arg mqttPassword "$MQTT_PASSWORD" \
  --arg azureMapsKey "$AZURE_MAPS_KEY" \
  --arg dnsZoneName "$DNS_ZONE_NAME" \
  --argjson enableDigitalTwins "$ENABLE_DIGITAL_TWINS" \
  --argjson enableAppService "$ENABLE_APP_SERVICE" \
  '{
    "$schema":"https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion":"1.0.0.0",
    "parameters":{
      "namePrefix":{"value":$namePrefix},
      "location":{"value":$location},
      "registryName":{"value":$registryName},
      "imageTag":{"value":$imageTag},
      "postgresAdminLogin":{"value":$postgresAdminLogin},
      "postgresAdminPassword":{"value":$postgresAdminPassword},
      "influxToken":{"value":$influxToken},
      "grafanaPassword":{"value":$grafanaPassword},
      "controlToken":{"value":$controlToken},
      "mqttUsername":{"value":$mqttUsername},
      "mqttPassword":{"value":$mqttPassword},
      "azureMapsKey":{"value":$azureMapsKey},
      "dnsZoneName":{"value":$dnsZoneName},
      "enableDigitalTwins":{"value":$enableDigitalTwins},
      "enableAppService":{"value":$enableAppService}
    }
  }' > "$PARAM_FILE"

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name hospital-iot-platform \
  --template-file "$ROOT_DIR/infra/azure/main.bicep" \
  --parameters "@$PARAM_FILE" \
  --output table

SEED_EXECUTION="$(az containerapp job start \
  --resource-group "$RESOURCE_GROUP" \
  --name "app-${NAME_PREFIX}-history-seed" \
  --query name \
  --output tsv)"

echo "Deployment completed. Read output URLs using:"
echo "az deployment group show -g \"$RESOURCE_GROUP\" -n hospital-iot-platform --query properties.outputs -o json"
echo "Historical six-day seed started as execution: $SEED_EXECUTION"
