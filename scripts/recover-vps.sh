#!/usr/bin/env bash
# =============================================================================
# Recuperação rápida — StreamServer na VPS (site offline / connection refused)
# =============================================================================
# Uso: cd /opt/StreamServer && bash scripts/recover-vps.sh
# =============================================================================
set -euo pipefail

COMPOSE_FILE="docker-compose.interserver.yml"

echo "=============================================="
echo " StreamServer — recuperação VPS"
echo "=============================================="

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Erro: corre a partir da raiz do projecto (/opt/StreamServer)." >&2
  exit 1
fi

echo ""
echo ">> Estado actual dos containers:"
docker compose -f "$COMPOSE_FILE" ps -a || true

echo ""
echo ">> Porta 80 (quem está a escutar):"
ss -tlnp | grep ':80 ' || echo "(nada na porta 80)"

echo ""
echo ">> A subir toda a stack..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo ">> A aguardar serviços (15s)..."
sleep 15

echo ""
echo ">> A testar configuração Nginx..."
if docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -t; then
  echo "Nginx: configuração OK"
else
  echo "ERRO: configuração Nginx inválida — ver logs abaixo." >&2
fi

echo ""
echo ">> A reiniciar Nginx..."
docker compose -f "$COMPOSE_FILE" restart nginx
sleep 3

echo ""
echo ">> Teste local:"
curl -fsS -m 5 -I http://localhost/ && echo "OK: http://localhost responde" || echo "FALHA: http://localhost não responde"

echo ""
echo ">> Teste API:"
curl -fsS -m 5 http://localhost/api/health && echo "" || echo "FALHA: /api/health"

echo ""
echo ">> Últimos logs Nginx:"
docker compose -f "$COMPOSE_FILE" logs --tail=20 nginx

echo ""
echo ">> Últimos logs Backend:"
docker compose -f "$COMPOSE_FILE" logs --tail=15 backend

echo ""
docker compose -f "$COMPOSE_FILE" ps
