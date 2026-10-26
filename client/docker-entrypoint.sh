#!/bin/sh
set -eu
if ! printf '%s' "${OTA_URL:-}" | grep -Eq '^https?://.+'; then
  echo "Set OTA_URL to the OTA URL this browser can reach" >&2
  exit 1
fi
escaped=$(printf '%s' "$OTA_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf 'window.SWITCHBOARD = { otaUrl: "%s" };\n' "$escaped" > /usr/share/nginx/html/config.js
exec /docker-entrypoint.sh "$@"
