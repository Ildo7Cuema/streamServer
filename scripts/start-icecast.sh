#!/usr/bin/env bash
# Start Icecast locally (no Docker) for StreamServer dev
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/infrastructure/icecast/icecast.local.xml"
LOGDIR="/tmp/icecast-logs"
PIDFILE="/tmp/icecast-streamserver.pid"

mkdir -p "$LOGDIR"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Icecast já está a correr (PID $(cat "$PIDFILE"))"
  exit 0
fi

echo "A iniciar Icecast na porta 8000..."
icecast -c "$CONFIG" &
echo $! > "$PIDFILE"
sleep 2

if curl -sf http://localhost:8000/status-json.xsl > /dev/null; then
  echo "✅ Icecast activo: http://localhost:8000"
  echo "   Status JSON: http://localhost:8000/status-json.xsl"
else
  echo "❌ Icecast não respondeu. Ver $LOGDIR/error.log"
  exit 1
fi
