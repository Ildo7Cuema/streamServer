#!/usr/bin/env bash
# =============================================================================
# Deploy seguro — StreamServer na VPS InterServer
# =============================================================================
# Uso: ./scripts/deploy-interserver.sh
#
# Em vez de correr git pull / docker compose build / up manualmente (e correr
# o risco de um passo falhar em silêncio, como já aconteceu), este script:
#   1) confirma que não há alterações locais não commitadas que bloqueiem o pull
#   2) faz pull e mostra exactamente o que mudou
#   3) reconstrói e reinicia só os serviços que a stack Docker gere
#   4) espera pelo backend e confirma /api/health antes de dizer "sucesso"
#
# Corre a partir da raiz do projecto (ex.: /opt/StreamServer).
# =============================================================================
set -euo pipefail

COMPOSE_FILE="docker-compose.interserver.yml"
HEALTH_URL="http://localhost/api/health"

echo "=============================================="
echo " StreamServer — deploy (InterServer)"
echo "=============================================="

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Erro: corre este script a partir da raiz do projecto (onde está $COMPOSE_FILE)." >&2
  exit 1
fi

echo ""
echo ">> A verificar estado do git..."
if ! git diff --quiet -- . ':!*.bak' 2>/dev/null; then
  echo ""
  echo "AVISO: há ficheiros com alterações locais não commitadas:"
  git status --short
  echo ""
  echo "Se estes ficheiros também mudaram no repositório remoto, o 'git pull'"
  echo "vai abortar sem tocar em nada (comportamento seguro do git, mas é fácil"
  echo "não reparar). Para ficheiros de configuração desta VPS que edita-te à"
  echo "mão de propósito (ex.: docker-compose.interserver.yml, nginx, icecast xml),"
  echo "considera 'git update-index --skip-worktree <ficheiro>' uma única vez,"
  echo "para o git deixar de tentar sobrepor-se a eles."
  echo ""
  read -p "Continuar mesmo assim com 'git pull'? [y/N] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deploy cancelado. Resolve as alterações locais e volta a correr o script."
    exit 1
  fi
fi

BEFORE_COMMIT=$(git rev-parse --short HEAD)
echo ">> Commit actual: $BEFORE_COMMIT"

echo ""
echo ">> git pull..."
if ! git pull; then
  echo ""
  echo "Erro: 'git pull' falhou (provavelmente conflito com ficheiros locais)." >&2
  echo "Nada foi reconstruído. Resolve o conflito manualmente e volta a correr." >&2
  exit 1
fi

AFTER_COMMIT=$(git rev-parse --short HEAD)
if [ "$BEFORE_COMMIT" = "$AFTER_COMMIT" ]; then
  echo ">> Já estava actualizado ($AFTER_COMMIT) — sem novos commits."
else
  echo ">> Actualizado de $BEFORE_COMMIT para $AFTER_COMMIT:"
  git log --oneline "$BEFORE_COMMIT..$AFTER_COMMIT"
fi

echo ""
echo ">> A reconstruir imagens (backend + dashboard)..."
docker compose -f "$COMPOSE_FILE" build backend dashboard

echo ""
echo ">> A reiniciar serviços..."
docker compose -f "$COMPOSE_FILE" up -d backend dashboard nginx

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
