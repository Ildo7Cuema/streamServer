#!/usr/bin/env bash
# =============================================================================
# Deploy seguro — StreamServer na VPS InterServer
# =============================================================================
# Uso: ./scripts/deploy-interserver.sh
#      FORCE_SYNC=1 ./scripts/deploy-interserver.sh   # força sync com GitHub
#      CI=true ./scripts/deploy-interserver.sh          # modo GitHub Actions
# =============================================================================
set -euo pipefail

COMPOSE_FILE="docker-compose.interserver.yml"
HEALTH_URL="http://localhost/api/health"

# Ficheiros frequentemente editados à mão na VPS (skip-worktree bloqueia reset).
VPS_LOCAL_CONFIGS=(
  infrastructure/nginx/nginx.interserver.conf
  infrastructure/nginx/conf.d/locations.interserver.conf
  docker-compose.interserver.yml
  infrastructure/icecast/icecast.interserver.xml
)

is_ci() {
  [ "${CI:-}" = "true" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]
}

force_sync_origin() {
  echo ">> A sincronizar com origin/main (forçado)..."
  git fetch origin main

  echo ">> A remover flags skip-worktree / assume-unchanged..."
  for f in "${VPS_LOCAL_CONFIGS[@]}"; do
    [ -e "$f" ] || continue
    git update-index --no-skip-worktree "$f" 2>/dev/null || true
    git update-index --no-assume-unchanged "$f" 2>/dev/null || true
  done

  # Descarta alterações locais em ficheiros tracked (mantém .env intacto).
  git checkout -f main 2>/dev/null || git checkout -f
  git reset --hard origin/main
}

echo "=============================================="
echo " StreamServer — deploy (InterServer)"
echo "=============================================="

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Erro: corre este script a partir da raiz do projecto (onde está $COMPOSE_FILE)." >&2
  exit 1
fi

echo ""
echo ">> A verificar estado do git..."
BEFORE_COMMIT=$(git rev-parse --short HEAD)
echo ">> Commit actual: $BEFORE_COMMIT"

if is_ci || [ "${FORCE_SYNC:-}" = "1" ]; then
  if ! git diff --quiet -- . ':!*.bak' 2>/dev/null; then
    echo "AVISO: alterações locais serão descartadas para igualar o GitHub:"
    git status --short || true
  fi
  force_sync_origin
else
  if ! git diff --quiet -- . ':!*.bak' 2>/dev/null; then
    echo ""
    echo "AVISO: há alterações locais não commitadas:"
    git status --short
    echo ""
    echo "Para forçar sync com GitHub (descarta alterações locais em ficheiros tracked):"
    echo "  FORCE_SYNC=1 bash scripts/deploy-interserver.sh"
    echo ""
    read -p "Continuar com 'git pull'? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Deploy cancelado."
      exit 1
    fi
  fi

  echo ""
  echo ">> git pull..."
  if ! git pull origin main; then
    echo ""
    echo "Erro: 'git pull' falhou." >&2
    echo "Corre com sync forçado:" >&2
    echo "  FORCE_SYNC=1 bash scripts/deploy-interserver.sh" >&2
    exit 1
  fi
fi

AFTER_COMMIT=$(git rev-parse --short HEAD)
if [ "$BEFORE_COMMIT" = "$AFTER_COMMIT" ]; then
  echo ">> Já estava actualizado ($AFTER_COMMIT) — sem novos commits."
else
  echo ">> Actualizado de $BEFORE_COMMIT para $AFTER_COMMIT:"
  git log --oneline "$BEFORE_COMMIT..$AFTER_COMMIT" || true
fi

echo ""
echo ">> A reconstruir imagens (backend + dashboard)..."
docker compose -f "$COMPOSE_FILE" build backend dashboard

echo ""
echo ">> A garantir dependências (postgres, redis, icecast)..."
docker compose -f "$COMPOSE_FILE" up -d postgres redis icecast

echo ""
echo ">> A reiniciar backend e dashboard..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate backend dashboard

echo ""
echo ">> A validar configuração Nginx (antes de reiniciar)..."
docker compose -f "$COMPOSE_FILE" run --rm --no-deps nginx nginx -t

echo ""
echo ">> A reiniciar Nginx..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate nginx

echo ""
echo ">> A aplicar migrações da base de dados..."
docker compose -f "$COMPOSE_FILE" exec -T backend npm run migrate || echo "AVISO: migração falhou — verifica manualmente com 'docker compose -f $COMPOSE_FILE exec backend npm run migrate'."

echo ""
echo ">> A verificar Nginx activo..."
if ! docker compose -f "$COMPOSE_FILE" ps nginx | grep -q 'Up'; then
  echo "❌ Container Nginx não está activo." >&2
  docker compose -f "$COMPOSE_FILE" logs --tail=30 nginx >&2 || true
  exit 1
fi

echo ""
echo ">> A verificar saúde do backend (até 60s)..."
ok=false
for i in $(seq 1 30); do
  if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
    ok=true
    break
  fi
  sleep 2
done

echo ""
docker compose -f "$COMPOSE_FILE" ps

echo ""
if [ "$ok" = true ]; then
  echo "✅ Deploy concluído — $HEALTH_URL respondeu."
  curl -fsS -m 5 "$HEALTH_URL" || true
  echo ""
else
  echo "❌ Deploy terminou mas $HEALTH_URL não respondeu em 60s." >&2
  echo "   Verifica: docker compose -f $COMPOSE_FILE logs --tail=50 backend nginx" >&2
  exit 1
fi
