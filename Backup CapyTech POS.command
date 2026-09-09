#!/bin/bash
cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "CapyTech POS needs Node.js on this Mac."
  echo "Ask your installer to finish setup, then double-click this file again."
  echo
  read -r -p "Press Return to close..."
  exit 1
fi

echo
echo "Backing up CapyTech POS..."
echo

node scripts/backup-shop.mjs
status=$?

echo
read -r -p "Press Return to close..."
exit "$status"
