#!/usr/bin/env bash
# =============================================================================
# StreamServer — bootstrap Icecast numa VM
# (InterServer, DigitalOcean, Oracle, Hetzner, Contabo, etc.)
# Uso na VM:
#   ./scripts/vm-icecast-bootstrap.sh
#   ./scripts/vm-icecast-bootstrap.sh 164.92.123.45
#   ./scripts/vm-icecast-bootstrap.sh 164.92.123.45 https://streamserver-ivu7.onrender.com
# =============================================================================
set -euo pipefail

PUBLIC_HOST="${1:-}"
BACKEND_URL="${2:-https://streamserver-ivu7.onrender.com}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -z "$PUBLIC_HOST" ]]; then
  echo ">> A detectar IP público..."
  PUBLIC_HOST="$(curl -s --max-time 10 ifconfig.me 2>/dev/null || true)"
  PUBLIC_HOST="${PUBLIC_HOST//$'\n'/}"
  if [[ -z "$PUBLIC_HOST" ]]; then
    echo "Não consegui detectar o IP. Uso: $0 SEU_IP_PUBLICO [BACKEND_URL]"
    exit 1
  fi
  echo ">> IP detectado: $PUBLIC_HOST"
fi

echo ">> Actualizar sistema (Ubuntu/Debian)..."
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl openssl
fi

if ! command -v docker >/dev/null 2>&1; then
  echo ">> Instalar Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "${USER:-root}" 2>/dev/null || true
  if ! docker info >/dev/null 2>&1; then
    echo ">> Docker instalado. Se der erro de permissão:"
    echo "   newgrp docker   OU   sudo ./vm-icecast-bootstrap.sh $PUBLIC_HOST"
    DOCKER="sudo docker"
  else
    DOCKER="docker"
  fi
else
  DOCKER="docker"
  if ! docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
  fi
fi

# UFW — abrir 8000 se activo (comum em Droplets / algumas VPS InterServer)
if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  echo ">> UFW activo — a abrir porta 8000..."
  sudo ufw allow 8000/tcp comment 'Icecast StreamServer' || true
  sudo ufw allow 22/tcp comment 'SSH' 2>/dev/null || true
fi

# CSF (ConfigServer Firewall) — frequente em VPS InterServer / cPanel
if command -v csf >/dev/null 2>&1 && [[ -f /etc/csf/csf.conf ]]; then
  echo ">> CSF detectado — a garantir TCP 8000 em TCP_IN/TCP_OUT..."
  ensure_csf_port() {
    local key="$1"
    local conf="/etc/csf/csf.conf"
    local line
    line="$(grep -E "^${key}" "$conf" || true)"
    if [[ -z "$line" ]]; then
      return
    fi
    if echo "$line" | grep -qE '[^0-9]8000([^0-9]|$)'; then
      return
    fi
    sudo sed -i.bak -E "s/^(${key}[[:space:]]*=[[:space:]]*\")([^\"]*)(\")/\1\2,8000\3/" "$conf"
  }
  ensure_csf_port 'TCP_IN'
  ensure_csf_port 'TCP_OUT'
  sudo csf -r || true
fi

# firewalld (CentOS/Alma por vezes na InterServer)
if command -v firewall-cmd >/dev/null 2>&1 && sudo systemctl is-active --quiet firewalld 2>/dev/null; then
  echo ">> firewalld activo — a abrir porta 8000..."
  sudo firewall-cmd --permanent --add-port=8000/tcp || true
  sudo firewall-cmd --reload || true
fi

ICECAST_DIR="$ROOT/infrastructure/icecast"
if [[ ! -f "$ICECAST_DIR/icecast.prod.xml" ]]; then
  if [[ -f "$SCRIPT_DIR/../icecast/icecast.prod.xml" ]]; then
    ICECAST_DIR="$(cd "$SCRIPT_DIR/../icecast" && pwd)"
    ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  elif [[ -f "$HOME/streamserver/icecast/icecast.prod.xml" ]]; then
    ICECAST_DIR="$HOME/streamserver/icecast"
    ROOT="$HOME/streamserver"
  else
    echo "Erro: icecast.prod.xml não encontrado."
    echo "Copia infrastructure/icecast para a VM ou faz git clone do repo."
    exit 1
  fi
fi

export ICECAST_VM_DIR="${ICECAST_VM_DIR:-$HOME/streamserver-icecast}"
bash "$SCRIPT_DIR/setup-icecast-vm.sh" "$PUBLIC_HOST" "$BACKEND_URL"

echo ""
echo "=============================================="
echo " StreamServer Icecast — próximos passos"
echo "=============================================="
echo "1. Firewall cloud / InterServer: TCP 8000 aberta (painel + CSF/UFW)"
echo "2. Teste no PC:"
echo "     curl http://$PUBLIC_HOST:8000/status-json.xsl"
echo "3. Render → Environment:"
echo "     ICECAST_DISABLED=false"
echo "     PUBLIC_ICECAST_HOST=$PUBLIC_HOST"
echo "     ICECAST_HOST=$PUBLIC_HOST"
echo "     ICECAST_PORT=8000"
echo "     ICECAST_ADMIN_USER=admin"
echo "     ICECAST_ADMIN_PASSWORD=<ver output acima>"
echo "     (NÃO definas INTERNAL_API_KEY)"
echo "4. Render → Manual Deploy"
echo "5. BUTT:"
echo "     Servidor=$PUBLIC_HOST  Porta=8000  SSL=Off"
echo "     Mount=/{slug}/live  User=source  Password=<dashboard>"
echo ""
echo "Ouvir online: https://stream-server-rouge.vercel.app/stream/<slug>/live"
echo ""
echo "Guias: infrastructure/icecast/INTERSERVER.md"
echo "       infrastructure/icecast/DIGITALOCEAN.md"
echo "       infrastructure/icecast/ORACLE-CLOUD-FREE.md"
