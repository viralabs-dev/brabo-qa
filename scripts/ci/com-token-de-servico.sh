#!/usr/bin/env bash
# Roda um comando com E2E_SERVICE_TOKEN no ambiente SÓ dele (AT-815 P3, RN-1064).
# Uso: com-token-de-servico.sh <.env do compose> -- <comando...>
# O token é o BRABO_SERVICE_TOKEN que o próprio job gerou no .env: aqui ele é mascarado e nunca impresso.
set -euo pipefail
arquivo="${1:?uso: com-token-de-servico.sh <.env> -- <comando...>}"
shift
[ "${1:-}" = "--" ] && shift
[ "$#" -gt 0 ] || { echo "faltou o comando" >&2; exit 2; }
token="$(sed -n 's/^BRABO_SERVICE_TOKEN=//p' "$arquivo" | head -n1)"
[ -n "$token" ] || { echo "BRABO_SERVICE_TOKEN ausente em $arquivo" >&2; exit 1; }
echo "::add-mask::$token"
E2E_SERVICE_TOKEN="$token" exec "$@"
