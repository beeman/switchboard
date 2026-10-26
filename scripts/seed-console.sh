#!/bin/bash
# Point a fresh console database at this Instance's Speech, Ollama, and
# Advertised WebSocket URL. Runs once the console has finished its own
# migrations. Safe to run again: every statement is an update.
set -eu

check() {
  name="$1"
  value="$2"
  pattern="$3"
  printf '%s' "$value" | grep -Eq "$pattern" || {
    echo "Console seed refused ${name}" >&2
    exit 1
  }
  case "$value" in
    *你的*|*"<"*|*">"*)
      echo "Console seed refused ${name}" >&2
      exit 1
      ;;
  esac
}

sql_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

check WEBSOCKET_URL "${WEBSOCKET_URL:-}" '^wss?://[^[:space:]]+/xiaozhi/v1/?$'
check OTA_URL "${OTA_URL:-}" '^https?://[^[:space:]]+/xiaozhi/ota/?$'
check OLLAMA_BASE_URL "${OLLAMA_BASE_URL:-}" '^https?://[^[:space:]]+$'
check OLLAMA_MODEL "${OLLAMA_MODEL:-}" '^[^[:space:]]+$'
check SPEECH_URL "${SPEECH_URL:-}" '^https?://[^[:space:]]+/v1/audio/speech$'

fronted_url="${OTA_URL%/xiaozhi/ota/}"
fronted_url="${fronted_url%/xiaozhi/ota}"

export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?Set MYSQL_ROOT_PASSWORD}"

mysql_exec() {
  mysql --protocol=tcp -h console-db -uroot --default-character-set=utf8mb4 \
    xiaozhi_esp32_server "$@"
}

ollama_json=$(printf '{"type":"ollama","model_name":"%s","base_url":"%s"}' \
  "$OLLAMA_MODEL" "$OLLAMA_BASE_URL")
speech_json=$(printf '{"type":"custom","method":"POST","url":"%s","params":{"model":"kokoro","input":"{prompt_text}","response_format":"mp3","voice":"af_heart","lang_code":"a","return_download_link":false,"speed":1,"stream":false},"format":"mp3","output_dir":"tmp/","language":"English"}' \
  "$SPEECH_URL")
asr_json='{"type":"fun_local","model_dir":"models/SenseVoiceSmall","output_dir":"tmp/","language":"en"}'
memory_json='{"type":"mem_local_short","llm":""}'
persona='You are a concise voice assistant. Speak in short spoken English.'
error_reply='Something went wrong. Please try again in a moment.'
goodbye='End the conversation with one short, warm goodbye.'

mysql_exec <<SQL
UPDATE ai_model_config SET is_default = 0 WHERE model_type = 'LLM';
UPDATE ai_model_config
  SET is_default = 1, is_enabled = 1, config_json = $(sql_quote "$ollama_json")
  WHERE id = 'LLM_OllamaLLM';

UPDATE ai_model_config SET is_default = 0 WHERE model_type = 'TTS';
UPDATE ai_model_config
  SET is_default = 1, is_enabled = 1, config_json = $(sql_quote "$speech_json")
  WHERE id = 'TTS_CustomTTS';

UPDATE ai_model_config
  SET is_enabled = 1, config_json = $(sql_quote "$asr_json")
  WHERE id = 'ASR_FunASR';

UPDATE ai_model_config SET is_default = 0 WHERE model_type = 'Memory';
UPDATE ai_model_config
  SET is_default = 1, is_enabled = 1, config_json = $(sql_quote "$memory_json")
  WHERE id = 'Memory_mem_local_short';

UPDATE ai_model_config SET is_default = 0 WHERE model_type = 'Intent';
UPDATE ai_model_config
  SET is_default = 1, is_enabled = 1
  WHERE id = 'Intent_nointent';

UPDATE ai_tts_voice
  SET name = 'Heart', tts_voice = 'af_heart', languages = 'English'
  WHERE id = 'TTS_CustomTTS0000';

UPDATE ai_agent_template
  SET asr_model_id = 'ASR_FunASR',
      vad_model_id = 'VAD_SileroVAD',
      llm_model_id = 'LLM_OllamaLLM',
      tts_model_id = 'TTS_CustomTTS',
      tts_voice_id = 'TTS_CustomTTS0000',
      tts_language = 'English',
      mem_model_id = 'Memory_mem_local_short',
      intent_model_id = 'Intent_nointent',
      language = 'English',
      vllm_model_id = NULL,
      system_prompt = $(sql_quote "$persona");

UPDATE ai_agent SET vllm_model_id = NULL;

UPDATE sys_params SET param_value = $(sql_quote "$WEBSOCKET_URL") WHERE param_code = 'server.websocket';
UPDATE sys_params SET param_value = $(sql_quote "$OTA_URL") WHERE param_code = 'server.ota';
UPDATE sys_params SET param_value = $(sql_quote "$fronted_url") WHERE param_code = 'server.fronted_url';
UPDATE sys_params SET param_value = 'false' WHERE param_code = 'server.auth.enabled';
UPDATE sys_params SET param_value = 'false' WHERE param_code = 'enable_wakeup_words_response_cache';
UPDATE sys_params SET param_value = '60' WHERE param_code = 'tts_timeout';
UPDATE sys_params SET param_value = $(sql_quote "$error_reply") WHERE param_code = 'system_error_response';
UPDATE sys_params SET param_value = 'true' WHERE param_code = 'end_prompt.enable';
UPDATE sys_params SET param_value = $(sql_quote "$goodbye") WHERE param_code = 'end_prompt.prompt';
SQL

secret=""
i=0
while [ "$i" -lt 30 ]; do
  secret="$(mysql_exec -N -e "SELECT param_value FROM sys_params WHERE param_code='server.secret'")"
  case "$secret" in
    "" | null) sleep 2 ;;
    *) break ;;
  esac
  i=$((i + 1))
done

printf '%s' "$secret" | grep -Eq '^[0-9a-fA-F-]{16,}$' || {
  echo "Console seed did not find server.secret" >&2
  exit 1
}

mkdir -p /switchboard-console
umask 077
printf '%s\n' "$secret" > /switchboard-console/secret

exec 3<>/dev/tcp/console-redis/6379
printf '*1\r\n$8\r\nFLUSHALL\r\n' >&3
IFS= read -r reply <&3
printf '%s' "$reply" | grep -q '+OK' || {
  echo "Console seed could not clear Redis" >&2
  exit 1
}

echo "console seed ok"
