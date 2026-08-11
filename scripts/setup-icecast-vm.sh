#!/usr/bin/env bash
# =============================================================================
# StreamServer — preparar Icecast numa VM/VPS (Ubuntu/Debian)
# Uso: ./scripts/setup-icecast-vm.sh SEU_HOST_PUBLICO [BACKEND_URL]
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICECAST_DIR="$ROOT/infrastructure/icecast"
PUBLIC_HOST="${1:-}"
BACKEND_URL="${2:-https://streamserver-ivu7.onrender.com}"

if [[ -z "$PUBLIC_HOST" ]]; then
  echo "Uso: $0 SEU_HOST_PUBLICO [BACKEND_URL]"
  echo "Exemplo: $0 icecast.example.com https://streamserver-ivu7.onrender.com"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker não encontrado. Instala com: curl -fsSL https://get.docker.com | sh"
  exit 1
fi

gen_secret() {
  openssl rand -base64 24 | tr -d '/+=' | head -c 22
}

SOURCE_PASS="${ICECAST_SOURCE_PASSWORD:-$(gen_secret)}"
RELAY_PASS="${ICECAST_RELAY_PASSWORD:-$(gen_secret)}"
ADMIN_PASS="${ICECAST_ADMIN_PASSWORD:-$(gen_secret)}"

WORKDIR="${ICECAST_VM_DIR:-$HOME/streamserver-icecast}"
mkdir -p "$WORKDIR"

# O compose monta ./icecast.prod.xml — manter este nome (bug antigo: gerava só icecast.xml).
cp "$ICECAST_DIR/icecast.prod.xml" "$WORKDIR/icecast.prod.xml"
cp "$ICECAST_DIR/docker-compose.vm.yml" "$WORKDIR/docker-compose.yml"

sed -i.bak \
  -e "s/CHANGE_ME_PUBLIC_HOST/$PUBLIC_HOST/g" \
  -e "s|https://streamserver-ivu7.onrender.com/api/internal/icecast/auth|${BACKEND_URL%/}/api/internal/icecast/auth|g" \
  -e "s/CHANGE_ME_SOURCE/$SOURCE_PASS/g" \
  -e "s/CHANGE_ME_RELAY/$RELAY_PASS/g" \
  -e "s/CHANGE_ME_ADMIN/$ADMIN_PASS/g" \
  "$WORKDIR/icecast.prod.xml"
rm -f "$WORKDIR/icecast.prod.xml.bak"

# Compat: symlink para quem espera icecast.xml no workdir
ln -sfn icecast.prod.xml "$WORKDIR/icecast.xml"

cd "$WORKDIR"
COMPOSE=(docker compose)
if ! docker info >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1; then
    COMPOSE=(sudo docker compose)
  else
    echo "Docker não está acessível. Tenta: sudo $0 $PUBLIC_HOST $BACKEND_URL"
    exit 1
  fi
fi
"${COMPOSE[@]}" up -d --force-recreate

echo ""
echo "=============================================="
echo " Icecast arrancado em $PUBLIC_HOST:8000"
echo "=============================================="
echo ""
echo "Teste (do teu PC):"
echo "  curl http://$PUBLIC_HOST:8000/status-json.xsl"
echo ""
echo "No Render → Environment, define:"
echo "  ICECAST_DISABLED=false"
echo "  PUBLIC_ICECAST_HOST=$PUBLIC_HOST"
echo "  ICECAST_HOST=$PUBLIC_HOST"
echo "  ICECAST_PORT=8000"
echo "  ICECAST_ADMIN_USER=admin"
echo "  ICECAST_ADMIN_PASSWORD=$ADMIN_PASS"
echo ""
echo "Firewall da VM / InterServer: abre TCP 8000 (e 22 para SSH)"
echo "Guia: infrastructure/icecast/INTERSERVER.md"
echo ""
echo "Passwords Icecast (guarda num sítio seguro):"
echo "  source-password: $SOURCE_PASS  (só se usares Liquidsoap/AutoDJ)"
echo "  admin-password:  $ADMIN_PASS"
echo ""
echo "O BUTT usa a source_password de cada estação (dashboard), não a source-password global do Icecast."
echo "Config BUTT: Servidor=$PUBLIC_HOST  Porta=8000  User=source  SSL=Off  Mount=/{slug}/live"
