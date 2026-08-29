#!/usr/bin/env bash
# =============================================================================
# Deploy completo na VPS — uma só comando
# Uso: cd /opt/StreamServer && FORCE_SYNC=1 bash scripts/vps-deploy.sh
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
exec env FORCE_SYNC=1 CI=true bash scripts/deploy-interserver.sh
