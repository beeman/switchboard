#!/usr/bin/env python3
"""Check that the Instance config renderer accepts a complete env and rejects a partial one."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RENDER = ROOT / "scripts" / "render_config.py"

GOOD = {
    "WEBSOCKET_URL": "ws://voice.example:8000/xiaozhi/v1/",
    "VISION_URL": "http://voice.example:8003/mcp/vision/explain",
    "OLLAMA_BASE_URL": "http://host.docker.internal:11434",
    "OLLAMA_MODEL": "qwen3",
    "SPEECH_URL": "http://speech:8880/v1/audio/speech",
    "SWITCHBOARD_RENDER_ONLY": "1",
    "SWITCHBOARD_TEMPLATE": str(ROOT / "config" / "instance.yaml.template"),
}


def run(env, output):
    full = os.environ.copy()
    full.update(env)
    full["SWITCHBOARD_CONFIG"] = str(output)
    return subprocess.run([sys.executable, str(RENDER)], env=full, text=True, capture_output=True)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / ".config.yaml"
        good = run(GOOD, output)
        if good.returncode != 0:
            sys.stderr.write(good.stderr)
            raise SystemExit("expected a complete env to render")
        text = output.read_text(encoding="utf-8")
        if "voice.example" not in text or "return_download_link: false" not in text:
            raise SystemExit("rendered config is missing the instance URL or Kokoro flags")
        if "你的" in text or "${" in text:
            raise SystemExit("rendered config still has a placeholder")

        bad_env = dict(GOOD)
        bad_env["WEBSOCKET_URL"] = ""
        bad = run(bad_env, output)
        if bad.returncode == 0:
            raise SystemExit("expected an empty Advertised WebSocket URL to fail")

        secret = Path(tmp) / "secret"
        secret.write_text("8f2dda09-cf18-f1c1-ece0-f906eee4cc2f\n", encoding="utf-8")
        console_env = {
            "SWITCHBOARD_CONSOLE": "1",
            "SWITCHBOARD_RENDER_ONLY": "1",
            "SWITCHBOARD_CONSOLE_TEMPLATE": str(ROOT / "config" / "instance-console.yaml.template"),
            "SWITCHBOARD_CONSOLE_SECRET_FILE": str(secret),
            "VISION_URL": GOOD["VISION_URL"],
            "MANAGER_URL": "http://console:8002/xiaozhi",
        }
        console = run(console_env, output)
        if console.returncode != 0:
            sys.stderr.write(console.stderr)
            raise SystemExit("expected console mode to render")
        console_text = output.read_text(encoding="utf-8")
        if "http://console:8002/xiaozhi" not in console_text or "selected_module" in console_text:
            raise SystemExit("console config should point at the console and leave modules in the database")
        if "8f2dda09-cf18-f1c1-ece0-f906eee4cc2f" not in console_text:
            raise SystemExit("console config is missing server.secret")

        missing_secret = dict(console_env)
        missing_secret["SWITCHBOARD_CONSOLE_SECRET_FILE"] = str(Path(tmp) / "missing")
        rejected = run(missing_secret, output)
        if rejected.returncode == 0:
            raise SystemExit("expected a missing console secret to fail")
    print("render_config ok")


if __name__ == "__main__":
    main()
