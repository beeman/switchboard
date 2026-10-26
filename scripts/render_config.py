#!/usr/bin/env python3
"""Render the Instance config, then start the voice server.

CustomTTS stores the HTTP body as the audio file. Kokoro returns one audio
file when stream and return_download_link are both false. A download link
would be stored as if it were audio.
"""

import os
import re
import sys
from pathlib import Path

OUTPUT = Path(os.environ.get("SWITCHBOARD_CONFIG", "/opt/xiaozhi-esp32-server/data/.config.yaml"))
LOCAL_TEMPLATE = Path(os.environ.get("SWITCHBOARD_TEMPLATE", "/switchboard/instance.yaml.template"))
CONSOLE_TEMPLATE = Path(
    os.environ.get("SWITCHBOARD_CONSOLE_TEMPLATE", "/switchboard/instance-console.yaml.template")
)
SECRET_FILE = Path(os.environ.get("SWITCHBOARD_CONSOLE_SECRET_FILE", "/switchboard-console/secret"))

LOCAL_CHECKS = {
    "WEBSOCKET_URL": re.compile(r"^wss?://\S+/xiaozhi/v1/?$"),
    "VISION_URL": re.compile(r"^https?://\S+/mcp/vision/explain$"),
    "OLLAMA_BASE_URL": re.compile(r"^https?://\S+$"),
    "OLLAMA_MODEL": re.compile(r"^\S+$"),
    "SPEECH_URL": re.compile(r"^https?://\S+/v1/audio/speech$"),
}
CONSOLE_CHECKS = {
    "VISION_URL": re.compile(r"^https?://\S+/mcp/vision/explain$"),
    "MANAGER_URL": re.compile(r"^https?://\S+/xiaozhi/?$"),
    "MANAGER_SECRET": re.compile(r"^[0-9a-fA-F-]{16,}$"),
}


def substitute(template: Path, checks: dict) -> str:
    text = template.read_text(encoding="utf-8")
    problems = []
    for key, pattern in checks.items():
        value = os.environ.get(key, "").strip()
        if not pattern.match(value) or "你的" in value or "<" in value or ">" in value:
            problems.append(key)
            continue
        text = text.replace("${" + key + "}", value)
    if problems:
        names = ", ".join(problems)
        raise SystemExit(f"Instance config is incomplete or not a reachable URL: {names}")
    if "${" in text:
        raise SystemExit("Instance config still has an unsubstituted placeholder")
    return text


def render() -> str:
    if os.environ.get("SWITCHBOARD_CONSOLE") == "1":
        secret = SECRET_FILE.read_text(encoding="utf-8").strip() if SECRET_FILE.is_file() else ""
        os.environ["MANAGER_SECRET"] = secret
        return substitute(CONSOLE_TEMPLATE, CONSOLE_CHECKS)
    return substitute(LOCAL_TEMPLATE, LOCAL_CHECKS)


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(render(), encoding="utf-8")
    if os.environ.get("SWITCHBOARD_RENDER_ONLY") == "1":
        return
    os.chdir("/opt/xiaozhi-esp32-server")
    os.execvp("python", ["python", "app.py"])


if __name__ == "__main__":
    main()
