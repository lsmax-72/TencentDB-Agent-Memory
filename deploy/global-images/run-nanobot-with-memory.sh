#!/usr/bin/env bash
set -euo pipefail

# Keep the user key outside nanobot's JSON config; this launcher selects the
# TencentDB-backed preset for this one process without changing normal runs.
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
key_file="$script_dir/.admin-key"

if [[ ! -s "$key_file" ]]; then
  echo "Missing local Memory Hub user key: $key_file" >&2
  exit 1
fi

export TDAI_USER_KEY
TDAI_USER_KEY=$(tr -d '\r\n' < "$key_file")

# nanobot does not interpolate arbitrary config-file placeholders. Inject the
# local user key and select the proxy preset in a process-private config copy.
# Config-file values take precedence over NANOBOT_* environment settings, so
# both fields must be adjusted here. The durable config keeps its direct vLLM
# default and never stores the key.
runtime_config=$(mktemp "${TMPDIR:-/tmp}/nanobot-tdai.XXXXXX.json")
trap 'rm -f "$runtime_config"' EXIT
jq --arg user_key "$TDAI_USER_KEY" '
  .providers.tdaiProxy.apiKey = $user_key
  | .agents.defaults.modelPreset = "tdai-qwen3.8-27b"
  | .agents.defaults.fallbackModels = []
' \
  /Users/lsmax/.nanobot/config.json > "$runtime_config"

/Users/lsmax/Coder/nanobot/.venv/bin/nanobot agent --config "$runtime_config" "$@"
