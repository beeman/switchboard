#!/bin/sh
# Build images from upstream tag v0.9.8 and push multi-arch manifests.
# The upstream tree is cloned into a temp directory. It is not vendored here.
# SWITCHBOARD_ONLY=voice builds the voice server. SWITCHBOARD_ONLY=console builds the console.
set -eu

pin_tag="v0.9.8"
version="0.9.8"
base_image="ghcr.io/beeman/switchboard-voice-server-base:${version}"
app_image="ghcr.io/beeman/switchboard-voice-server:${version}"
console_image="ghcr.io/beeman/switchboard-console:${version}"
platforms="${SWITCHBOARD_PLATFORMS:-linux/amd64,linux/arm64}"
only="${SWITCHBOARD_ONLY:-all}"
src="$(mktemp -d)"
trap 'rm -rf "$src"' EXIT INT TERM

git clone --depth 1 --branch "$pin_tag" \
  https://github.com/xinnan-tech/xiaozhi-esp32-server.git "$src"

python3 - "$src" "$base_image" <<'PY'
import pathlib, sys
root, base = sys.argv[1:]
dockerfile = pathlib.Path(root, "Dockerfile-server")
text = dockerfile.read_text()
old = "FROM ghcr.io/xinnan-tech/xiaozhi-esp32-server:server-base"
if old not in text:
    raise SystemExit("upstream Dockerfile-server no longer uses the expected base image")
text = text.replace(old, f"FROM {base}", 1)
if "UPSTREAM-LICENSE" not in text:
    text = text.replace(
        "COPY main/xiaozhi-server .",
        "COPY main/xiaozhi-server .\nCOPY LICENSE /opt/xiaozhi-esp32-server/UPSTREAM-LICENSE",
        1,
    )
dockerfile.write_text(text)
web = pathlib.Path(root, "Dockerfile-web")
web_text = web.read_text()
marker = "COPY docs/docker/start.sh /start.sh"
if "UPSTREAM-LICENSE" not in web_text:
    if marker not in web_text:
        raise SystemExit("upstream Dockerfile-web no longer copies start.sh where expected")
    web.write_text(web_text.replace(marker, "COPY LICENSE /app/UPSTREAM-LICENSE\n" + marker, 1))
PY

output="--push"
if [ "${SWITCHBOARD_PUSH:-1}" = "0" ]; then
  echo "SWITCHBOARD_PUSH=0 writes a local image. Multi-arch --load is not supported." >&2
  output="--load"
  platforms="$(uname -m | sed -e 's/aarch64/linux\/arm64/' -e 's/arm64/linux\/arm64/' -e 's/x86_64/linux\/amd64/' -e 's/amd64/linux\/amd64/')"
fi

if [ "$only" = "all" ] || [ "$only" = "voice" ]; then
  docker buildx build \
    --platform "$platforms" \
    -f "$src/Dockerfile-server-base" \
    -t "$base_image" \
    $output \
    "$src"

  docker buildx build \
    --platform "$platforms" \
    -f "$src/Dockerfile-server" \
    -t "$app_image" \
    $output \
    "$src"
  echo "base $base_image"
  echo "app  $app_image"
fi

if [ "$only" = "all" ] || [ "$only" = "console" ]; then
  docker buildx build \
    --platform "$platforms" \
    -f "$src/Dockerfile-web" \
    -t "$console_image" \
    $output \
    "$src"
  echo "console $console_image"
fi
