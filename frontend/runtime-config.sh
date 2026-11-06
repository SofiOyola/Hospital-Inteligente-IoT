#!/bin/sh
set -eu
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3001}"
export GRAFANA_URL
envsubst '${GRAFANA_URL}' < /usr/share/nginx/html/runtime-config.template.js > /usr/share/nginx/html/runtime-config.js
