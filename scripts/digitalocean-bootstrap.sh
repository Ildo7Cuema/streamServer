#!/usr/bin/env bash
# DigitalOcean Droplet — instala Icecast (alias)
exec "$(dirname "$0")/vm-icecast-bootstrap.sh" "$@"
