#!/usr/bin/env bash
# Repara HTTPS na VPS — usa certificado Let's Encrypt existente
# Uso: cd /opt/StreamServer && bash scripts/fix-ssl-now.sh
set -euo pipefail

COMPOSE_FILE="docker-compose.interserver.yml"
NGINX_CONF="infrastructure/nginx/nginx.interserver.conf"
LOCATIONS="infrastructure/nginx/conf.d/locations.interserver.conf"

cd "$(dirname "$0")/.."

echo ">> 1/5 Certificado..."
if [ ! -f /etc/letsencrypt/live/onlineradio24.com/fullchain.pem ]; then
  echo "ERRO: certificado não encontrado em /etc/letsencrypt/live/onlineradio24.com/" >&2
  exit 1
fi
echo "OK"

echo ">> 2/5 Docker Compose — porta 443 + volume certs..."
python3 << 'PY'
from pathlib import Path
p = Path("docker-compose.interserver.yml")
text = p.read_text()
if '443:443' not in text:
    text = text.replace('- "80:80"', '- "80:80"\n      - "443:443"', 1)
if '/etc/letsencrypt' not in text:
    text = text.replace(
        '- ./player:/usr/share/nginx/html/player:ro',
        '- ./player:/usr/share/nginx/html/player:ro\n'
        '      - /etc/letsencrypt:/etc/letsencrypt:ro',
        1
    )
p.write_text(text)
print("docker-compose actualizado")
PY

echo ">> 3/5 Nginx — config SSL..."
cat > "$NGINX_CONF" << 'EOF'
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
    multi_accept on;
    use epoll;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    client_max_body_size 500M;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
    limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
    limit_conn_zone $binary_remote_addr zone=stream_conn:10m;
    limit_req_status 429;
    limit_conn_status 429;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    resolver 127.0.0.11 valid=10s;

    upstream icecast_server {
        server icecast:8000;
    }

    server {
        listen 80;
        server_name onlineradio24.com www.onlineradio24.com;
        return 301 https://$host$request_uri;
    }

    server {
        listen 80 default_server;
        server_name _;
        set $backend_upstream backend:3000;
        set $dashboard_upstream dashboard:80;
        include /etc/nginx/conf.d/locations.interserver.conf;
    }

    server {
        listen 443 ssl;
        http2 on;
        server_name onlineradio24.com www.onlineradio24.com;

        ssl_certificate     /etc/letsencrypt/live/onlineradio24.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/onlineradio24.com/privkey.pem;
        ssl_protocols       TLSv1.2 TLSv1.3;

        set $backend_upstream backend:3000;
        set $dashboard_upstream dashboard:80;
        include /etc/nginx/conf.d/locations.interserver.conf;
    }
}
EOF

if [ ! -s "$LOCATIONS" ]; then
  BACKUP=$(ls -1 "$LOCATIONS".backup-* 2>/dev/null | tail -1 || true)
  if [ -n "$BACKUP" ]; then
    cp "$BACKUP" "$LOCATIONS"
    echo "locations restaurado de $BACKUP"
  else
    echo "ERRO: $LOCATIONS em falta" >&2
    exit 1
  fi
fi

echo ">> 4/5 A reiniciar Nginx..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate nginx
sleep 4

echo ">> 5/5 Testes..."
docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -t
docker compose -f "$COMPOSE_FILE" ps nginx
ss -tlnp | grep -E ':80|:443' || true

curl -fsS -I http://127.0.0.1/ | head -3 || echo "HTTP local: FALHOU"
curl -fsSk -I https://onlineradio24.com/ | head -5 || echo "HTTPS: FALHOU"

echo ""
echo "Se HTTPS OK, abre https://onlineradio24.com no browser."
