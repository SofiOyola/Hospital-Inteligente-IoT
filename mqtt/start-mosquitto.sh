#!/bin/sh
set -eu

if [ -z "${MOSQUITTO_USERNAME:-}" ] || [ -z "${MOSQUITTO_PASSWORD:-}" ]; then
  echo "MOSQUITTO_USERNAME and MOSQUITTO_PASSWORD are required." >&2
  exit 1
fi

if [ -f /mosquitto/config/passwords ]; then
  mosquitto_passwd -b /mosquitto/config/passwords "$MOSQUITTO_USERNAME" "$MOSQUITTO_PASSWORD"
else
  mosquitto_passwd -b -c /mosquitto/config/passwords "$MOSQUITTO_USERNAME" "$MOSQUITTO_PASSWORD"
fi
chmod 600 /mosquitto/config/passwords
exec mosquitto -c /mosquitto/config/mosquitto.conf
