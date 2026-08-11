#!/usr/bin/env bash
# Stop local Icecast instance started by start-icecast.sh
PIDFILE="/tmp/icecast-streamserver.pid"

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Icecast parado (PID $PID)"
  fi
  rm -f "$PIDFILE"
else
  pkill -f "icecast -c.*icecast.local.xml" 2>/dev/null && echo "Icecast parado" || echo "Icecast não estava a correr"
fi
