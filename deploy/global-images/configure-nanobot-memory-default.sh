#!/usr/bin/env bash
# Make the local nanobot CLI use TencentDB Memory Proxy by default.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_path="${HOME}/.nanobot/config.json"
key_path="${script_dir}/.admin-key"

if [[ ! -r "${config_path}" ]]; then
  echo "nanobot config not found: ${config_path}" >&2
  exit 1
fi
if [[ ! -s "${key_path}" ]]; then
  echo "Memory Hub user key not found: ${key_path}" >&2
  exit 1
fi

user_key="$(tr -d '\r\n' < "${key_path}")"
temporary_config="$(mktemp "${config_path}.tmp.XXXXXX")"
trap 'rm -f "${temporary_config}"' EXIT

# Fallbacks are intentionally disabled: a fallback provider would bypass the
# proxy and make a nanobot conversation partly unobservable to Memory Hub.
jq \
  --arg user_key "${user_key}" \
  '.agents.defaults.modelPreset = "tdai-qwen3.8-27b"
   | .agents.defaults.fallbackModels = []
   | .providers.tdaiProxy.apiKey = $user_key' \
  "${config_path}" > "${temporary_config}"

mv "${temporary_config}" "${config_path}"
trap - EXIT

echo "Configured nanobot default model preset: tdai-qwen3.8-27b"
echo "Fallback models: disabled"
echo "TencentDB Memory Proxy: http://127.0.0.1:8096/proxy/default/v1"
