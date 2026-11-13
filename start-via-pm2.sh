#!/bin/bash
set -u
cd "$(dirname "$0")" || exit 1

pm2 delete health-check >/dev/null 2>&1 || true
pm2 start health-check.js --name health-check --max-memory-restart 200M
