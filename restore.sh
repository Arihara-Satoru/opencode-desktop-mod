#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================================"
echo " OpenCode Desktop Official Restore Tool"
echo "========================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[Error] Node.js is required but not installed."
  echo "Please install Node.js (v18+) from https://nodejs.org/"
  exit 1
fi

node "$DIR/apply-mod.mjs" --restore
