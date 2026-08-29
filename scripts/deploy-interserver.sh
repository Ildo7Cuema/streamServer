#!/usr/bin/env bash
# =============================================================================
# Deploy seguro — StreamServer na VPS InterServer
# =============================================================================
# Uso: ./scripts/deploy-interserver.sh
#
# Em vez de correr git pull / docker compose build / up manualmente (e correr
# o risco de um passo falhar em silêncio, como já aconteceu), este script:
#   1) sincroniza o código com origin/main (pull manual ou reset em CI)
#   2) reconstrói e reinicia backend, dashboard e nginx
#   3) aplica migrações
#   4) espera pelo backend e confirma /api/health antes de dizer "sucesso"
#
# Corre a partir da raiz do projecto (ex.: /opt/StreamServer).
# =============================================================================
set -euo pipefail

COMPOSE_FILE="docker-compose.interserver.yml"
HEALTH_URL="http://localhost/api/health"

is_ci() {
  [ "${CI:-}" = "true" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]
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

if is_ci; then
  echo ""
  echo ">> Modo automático (CI): sincronizar com origin/main..."
  if ! git diff --quiet -- . ':!*.bak' 2>/dev/null; then
    echo "AVISO: alterações locais na VPS serão descartadas para igualar o GitHub:"
    git status --short || true
  fi
  git fetch origin main
  git reset --hard origin/main
else
  if ! git diff --quiet -- . ':!*.bak' 2>/dev/null; then
    echo ""
    echo "AVISO: há ficheiros com alterações locais não commitadas:"
    git status --short
    echo ""
    echo "Se estes ficheiros também mudaram no repositório remoto, o 'git pull'"
    echo "vai abortar. Para configs editadas à mão na VPS, usa:"
    echo "  git update-index --skip-worktree <ficheiro>"
    echo ""
    read -p "Continuar mesmo assim com 'git pull'? [y/N] " -n 1 -r
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
    echo "Erro: 'git pull' falhou (provavelmente conflito com ficheiros locais)." >&2
    echo "Na VPS podes forçar sync com:" >&2
    echo "  git fetch origin main && git reset --hard origin/main" >&2
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
docker compose -f "$COMPOSE_FILE" build --pull backend dashboard

echo ""
echo ">> A reiniciar serviços..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate backend dashboard nginx

echo ""
echo ">> A validar configuração Nginx..."
docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -t

echo ""
echo ">> A aplicar migrações da base de dados..."
docker compose -f "$COMPOSE_FILE" exec -T backend npm run migrate || echo "AVISO: migração falhou — verifica manualmente com 'docker compose -f $COMPOSE_FILE exec backend npm run migrate'."

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
