#!/usr/bin/env bash
# =============================================================================
# Verifica se Icecast (VM) + backend (Render) estão prontos para o BUTT.
# Uso:
#   ./scripts/verify-icecast-butt.sh SEU_IP_INTERSERVER
#   ./scripts/verify-icecast-butt.sh SEU_IP_INTERSERVER https://streamserver-ivu7.onrender.com
# =============================================================================
set -euo pipefail

ICECAST_HOST="${1:-}"
BACKEND_URL="${2:-https://streamserver-ivu7.onrender.com}"

if [[ -z "$ICECAST_HOST" ]]; then
  echo "Uso: $0 SEU_IP_OU_DNS_ICECAST [BACKEND_URL]"
  exit 1
fi

BACKEND_URL="${BACKEND_URL%/}"
ok=0
fail=0

check() {
  local name="$1"
  local cmd="$2"
  echo -n "• $name ... "
  if eval "$cmd" >/dev/null 2>&1; then
    echo "OK"
    ok=$((ok + 1))
  else
    echo "FALHOU"
    fail=$((fail + 1))
  fi
}

echo "=== StreamServer — verificação Icecast / BUTT ==="
echo "Icecast:  $ICECAST_HOST:8000"
echo "Backend:  $BACKEND_URL"
echo ""

check "Icecast status-json (porta 8000)" \
  "curl -fsS --max-time 8 \"http://${ICECAST_HOST}:8000/status-json.xsl\""

check "Backend health" \
  "curl -fsS --max-time 15 \"${BACKEND_URL}/api/health\""

echo -n "• PUBLIC_ICECAST_HOST no Render ... "
HEALTH_JSON="$(curl -fsS --max-time 15 "${BACKEND_URL}/api/health" 2>/dev/null || true)"
if echo "$HEALTH_JSON" | grep -q "\"publicIcecastHost\":\"${ICECAST_HOST}\""; then
  echo "OK (coincide com $ICECAST_HOST)"
  ok=$((ok + 1))
elif echo "$HEALTH_JSON" | grep -q '"icecastConfigured":true'; then
  echo "AVISO (configured=true mas host pode diferir)"
  echo "    $HEALTH_JSON" | head -c 400
  echo ""
  ok=$((ok + 1))
else
  echo "FALHOU — define PUBLIC_ICECAST_HOST=$ICECAST_HOST no Render"
  fail=$((fail + 1))
fi

echo -n "• Callback auth alcançável ... "
AUTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
  "${BACKEND_URL}/api/internal/icecast/auth?action=stream_auth&user=source&pass=invalid&mount=/live" || echo 000)"
if [[ "$AUTH_CODE" == "401" || "$AUTH_CODE" == "200" ]]; then
  echo "OK (HTTP $AUTH_CODE)"
  ok=$((ok + 1))
else
  echo "FALHOU (HTTP $AUTH_CODE) — Render a dormir ou URL errada?"
  fail=$((fail + 1))
fi

echo ""
echo "Resultado: $ok ok, $fail falhas"
if [[ "$fail" -gt 0 ]]; then
  echo "Guia InterServer: infrastructure/icecast/INTERSERVER.md"
  exit 1
fi

echo ""
echo "BUTT: Servidor=$ICECAST_HOST  Porta=8000  User=source  SSL=Off  Mount=/{slug}/live"
echo "Password = source_password da estação no dashboard."
exit 0
