# Switchboard

An Instance is one Docker Compose project: the Xiaozhi voice server, Kokoro for local speech, and a small web client. A console profile adds the manager UI when you want accounts, agents, and device binding. Devices that speak the Xiaozhi OTA and WebSocket protocol connect to it. The voice server source stays upstream. This repo pins `v0.9.8`, publishes multi-arch images, and owns the Compose file, the Instance config, and the client.

The repo and the images are public. An Instance has no device auth. Keep its ports on a network you trust. A tailnet is the usual place. This repo does not run Tailscale, bind port 443, or ship a proxy.

## What you need

- Docker with Compose
- Ollama on the host, with the model `qwen3` already pulled
- The FunASR weights, which are not in git (about 893 MB)

```sh
./scripts/download-funasr.sh
```

That writes `models/SenseVoiceSmall/model.pt`.

## Start one Instance

```sh
cp .env.example .env
```

Edit `.env`. Replace every `<host>` with a name or address that the browser and the devices can open. `127.0.0.1` works for a browser on this machine. It does not work for another machine or an ESP32.

`WEBSOCKET_URL` is the Advertised WebSocket URL. Every OTA response from this Instance returns that one URL.

```sh
docker compose up
```

The client is at `http://127.0.0.1:8006` when `CLIENT_PORT` is `8006`. Click Connect. It calls `OTA_URL`, then opens the WebSocket from that response. Type a message, or hold the talk button.

Speech is Kokoro inside the Instance (`af_heart`, American English). The voice server calls it at `http://speech:8880` on the Compose network. Ollama stays on the host at `http://host.docker.internal:11434`.

The first start is slow. The voice server loads FunASR, and Kokoro loads its model before it is healthy.

The voice server also prints a container address at startup. That line is not the Advertised WebSocket URL. Check with `curl` against the OTA URL. The body names the URL devices will use.

Local memory is selected, and the conversation still runs. On disconnect, upstream logs `保存记忆失败` because its Ollama provider has no `api_key` attribute and the memory check does `"你" in modelKey`. This repo does not patch the server for that. Saved memory stays empty until that upstream check accepts Ollama.

## Point a device at it

In the device firmware, set the OTA URL to the same path the client uses, with a host the device can reach:

```text
http://<host>:8003/xiaozhi/ota/
```

Use your `VOICE_HTTP_PORT` if it is not `8003`. The device reads `websocket.url` from the OTA response and connects there. That URL is `WEBSOCKET_URL`. A device that cannot open it needs a route to that address, or a second Instance whose Advertised WebSocket URL it can open.

## Start a second Instance

Use a second env file and a second Compose project name. Change the four host ports and the three URLs. The FunASR weights can be the same directory. Ollama is shared. Conversation memory is a volume named by the project, so the two Instances do not share it.

```sh
cp .env.example school.env
```

In `school.env`:

```sh
COMPOSE_PROJECT_NAME=switchboard-school
VOICE_WS_PORT=8100
VOICE_HTTP_PORT=8103
SPEECH_PORT=8180
CLIENT_PORT=8106
WEBSOCKET_URL=ws://<host>:8100/xiaozhi/v1/
VISION_URL=http://<host>:8103/mcp/vision/explain
OTA_URL=http://<host>:8103/xiaozhi/ota/
```

```sh
docker compose --env-file school.env up
```

## Images

Compose pulls:

- `ghcr.io/beeman/switchboard-voice-server:0.9.8`
- `ghcr.io/beeman/switchboard-client:0.1.0`
- `ghcr.io/beeman/switchboard-console:0.9.8` (only with the console profile)
- `ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0` (already multi-arch; this repo does not rebuild it)

The voice server image is built from upstream tag `v0.9.8` for `linux/amd64` and `linux/arm64`. Upstream tags named `server_latest` are amd64-only since 0.8.2.

```sh
./scripts/build-images.sh
```

That clones the pin into a temp directory, builds the voice server and the console, and pushes them. `SWITCHBOARD_ONLY=console` or `SWITCHBOARD_ONLY=voice` builds one of them. `SWITCHBOARD_PUSH=0` loads the image for the machine you are on instead of pushing.

The client image is also built by Compose from `client/` when a local image is not present. Publish it with:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/beeman/switchboard-client:0.1.0 --push client
```

The voice server is MIT licensed, Copyright (c) 2025 xinnan-tech. The build copies that license into the image as `UPSTREAM-LICENSE`.

## Console

The console is upstream's manager UI and API. It is off unless you start the `console` profile. The browser language chooses the UI language. English is used when the browser is not Chinese, German, Vietnamese, or Portuguese. Some seeded names and docs stay Chinese.

With the profile off, module settings stay in the rendered config file. With it on, the voice server reads those settings from the console. The first run writes Ollama, Kokoro (`af_heart`, `stream` false, `return_download_link` false), FunASR in English, and the Advertised WebSocket URL into the database. Device auth stays off. MySQL and Redis are only on the Compose network. The database password defaults to `switchboard`.

In `.env`:

```sh
SWITCHBOARD_CONSOLE=1
CONSOLE_PORT=8002
OTA_URL=http://<host>:8002/xiaozhi/ota/
```

`OTA_URL` has to be the console, on `CONSOLE_PORT`, not the voice server's port 8003. A browser and a device both send OTA there. The response still returns `WEBSOCKET_URL`.

```sh
docker compose --profile console up
```

Open `http://127.0.0.1:8002` when `CONSOLE_PORT` is `8002`. Register the first account. That account is the administrator. The password needs an uppercase letter, a lowercase letter, and a digit. Add an agent, connect the client, and bind it with the six-digit code the client prints.

Changing `WEBSOCKET_URL`, `OLLAMA_MODEL`, `OLLAMA_BASE_URL`, or `SPEECH_URL` after the first console start does not rewrite the database by itself. Apply it again, then restart the voice server:

```sh
docker compose --profile console run --rm --no-deps console-seed
docker compose --profile console restart voice-server
```

The console image is `ghcr.io/beeman/switchboard-console:0.9.8`, built from upstream `Dockerfile-web` at the same pin. `SWITCHBOARD_ONLY=console ./scripts/build-images.sh` builds that image without rebuilding the voice server.

Device auth stays off.
