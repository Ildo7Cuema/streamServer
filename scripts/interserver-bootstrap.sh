#!/usr/bin/env bash
# =============================================================================
# StreamServer — bootstrap completo na VPS InterServer
# (Postgres + Redis + Icecast + Backend + Dashboard + Nginx)
#
# Uso na VPS (Ubuntu), na raiz do repo:
#   chmod +x scripts/interserver-bootstrap.sh
#   ./scripts/interserver-bootstrap.sh
#   ./scripts/interserver-bootstrap.sh 66.45.xxx.xxx
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PUBLIC_HOST="${1:-}"
if [[ -z "$PUBLIC_HOST" ]]; then
  echo ">> A detectar IP público..."
  PUBLIC_HOST="$(curl -s --max-time 10 ifconfig.me 2>/dev/null || true)"
  PUBLIC_HOST="${PUBLIC_HOST//$'\n'/}"
  if [[ -z "$PUBLIC_HOST" ]]; then
    echo "Uso: $0 SEU_IP_INTERSERVER"
    exit 1
  fi
fi
echo ">> PUBLIC_HOST=$PUBLIC_HOST"

gen_secret() {
  openssl rand -base64 32 | tr -d '/+=' | head -c "${1:-32}"
}

if ! command -v docker >/dev/null 2>&1; then
  echo ">> Instalar Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "${USER:-root}" 2>/dev/null || true
fi

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
fi

# Firewall
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 22/tcp 2>/dev/null || true
  sudo ufw allow 80/tcp 2>/dev/null || true
  sudo ufw allow 443/tcp 2>/dev/null || true
  sudo ufw allow 8000/tcp comment 'Icecast BUTT' 2>/dev/null || true
  if sudo ufw status 2>/dev/null | grep -q "Status: inactive"; then
    echo ">> UFW inactivo — activa manualmente se precisares: sudo ufw enable"
  fi
fi

if command -v csf >/dev/null 2>&1 && [[ -f /etc/csf/csf.conf ]]; then
  echo ">> CSF — garante portas 80, 443 e 8000 em TCP_IN"
  for port in 80 443 8000; do
    if ! grep -E "^TCP_IN" /etc/csf/csf.conf | grep -qE "[^0-9]${port}([^0-9]|$)"; then
      sudo sed -i.bak -E "s/^(TCP_IN[[:space:]]*=[[:space:]]*\")([^\"]*)(\")/\1\2,${port}\3/" /etc/csf/csf.conf
    fi
  done
  sudo csf -r || true
fi

# .env
if [[ ! -f "$ROOT/.env" ]]; then
  echo ">> A criar .env a partir de .env.interserver.example"
  cp "$ROOT/.env.interserver.example" "$ROOT/.env"
fi

ADMIN_PASS="$(gen_secret 22)"
SOURCE_PASS="$(gen_secret 22)"
RELAY_PASS="$(gen_secret 22)"
DB_PASS="$(gen_secret 24)"
REDIS_PASS="$(gen_secret 24)"
JWT_SECRET="$(gen_secret 48)"

# Actualizar .env (valores chave)
set_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ROOT/.env"; then
    sed -i.bak -E "s|^${key}=.*|${key}=${val}|" "$ROOT/.env"
  else
    echo "${key}=${val}" >> "$ROOT/.env"
  fi
}

set_env PUBLIC_HOST "$PUBLIC_HOST"
set_env APP_URL "http://${PUBLIC_HOST}"
set_env PUBLIC_STREAM_URL "http://${PUBLIC_HOST}"
set_env CORS_ORIGINS "http://${PUBLIC_HOST}"
set_env PUBLIC_ICECAST_HOST "$PUBLIC_HOST"
set_env ICECAST_HOST "icecast"
set_env ICECAST_DISABLED "false"
set_env ICECAST_ADMIN_PASSWORD "$ADMIN_PASS"
set_env ICECAST_SOURCE_PASSWORD "$SOURCE_PASS"
set_env ICECAST_RELAY_PASSWORD "$RELAY_PASS"
set_env POSTGRES_PASSWORD "$DB_PASS"
set_env REDIS_PASSWORD "$REDIS_PASS"
set_env JWT_SECRET "$JWT_SECRET"
set_env NODE_ENV "production"
# Produção SaaS: utilizadores devem activar plano (não auto-subscribe de dev)
if grep -qE '^DEV_AUTO_SUBSCRIBE=' "$ROOT/.env"; then
  set_env DEV_AUTO_SUBSCRIBE "false"
fi
rm -f "$ROOT/.env.bak"

# Patch Icecast XML
ICE_XML="$ROOT/infrastructure/icecast/icecast.interserver.xml"
sed -i.bak \
  -e "s/CHANGE_ME_PUBLIC_HOST/$PUBLIC_HOST/g" \
  -e "s/CHANGE_ME_SOURCE/$SOURCE_PASS/g" \
  -e "s/CHANGE_ME_RELAY/$RELAY_PASS/g" \
  -e "s/CHANGE_ME_ADMIN/$ADMIN_PASS/g" \
  "$ICE_XML"
rm -f "${ICE_XML}.bak"

echo ">> A construir e arrancar stack..."
"${DOCKER[@]}" compose -f docker-compose.interserver.yml --env-file .env up -d --build

echo ">> A aplicar migrações da base de dados..."
for i in $(seq 1 30); do
  if "${DOCKER[@]}" compose -f docker-compose.interserver.yml exec -T backend wget -q -O /dev/null http://127.0.0.1:3000/api/health 2>/dev/null; then
    break
  fi
  sleep 2
done
"${DOCKER[@]}" compose -f docker-compose.interserver.yml exec -T backend npm run migrate || true
"${DOCKER[@]}" compose -f docker-compose.interserver.yml exec -T backend npm run seed || true

echo ""
echo "=============================================="
echo " StreamServer na InterServer — pronto"
echo "=============================================="
echo "Dashboard:  http://${PUBLIC_HOST}/"
echo "API health: http://${PUBLIC_HOST}/health"
echo "Icecast:    http://${PUBLIC_HOST}:8000/status-json.xsl"
echo "Ouvir:      http://${PUBLIC_HOST}/stream/<slug>/live"
echo ""
echo "BUTT:"
echo "  Servidor = ${PUBLIC_HOST}"
echo "  Porta    = 8000"
echo "  User     = source"
echo "  Password = source_password da estação (dashboard)"
echo "  Mount    = /{slug}/live"
echo "  SSL      = Off"
echo ""
echo "Passwords geradas (guarda .env com segurança):"
echo "  ICECAST_ADMIN_PASSWORD=$ADMIN_PASS"
echo "  POSTGRES_PASSWORD=$DB_PASS"
echo ""
echo "Admin seed: email/username do seed.js (ou re-executa npm run seed)"
echo ""
echo "Firewall InterServer: TCP 22, 80, 8000"
echo "Guia: infrastructure/icecast/INTERSERVER.md"
