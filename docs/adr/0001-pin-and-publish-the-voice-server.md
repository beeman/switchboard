# Pin and publish the voice server

This repo does not vendor or fork `xiaozhi-esp32-server`. An Instance runs images built from upstream tag `0.9.8` (`Dockerfile-server-base` and `Dockerfile-server`) and published as public multi-arch packages. Upstream is MIT, so the copyright notice travels with the build. The repo and the images are public. Running an Instance is internal: hostnames and the Advertised WebSocket URL live in the Instance config, which is not in git.

Publishing our own images is required because the upstream `server_latest` tags are amd64-only since 0.8.2. Forking was rejected because that project is actively maintained and this repo would then own the whole server. Private packages were rejected because the images contain no Instance config and the repo is public.

Speech stays the upstream Kokoro CPU image, pinned to `v0.9.0`, which is already multi-arch. We do not rebuild it. Pulling our images needs no login. Pushing does.
