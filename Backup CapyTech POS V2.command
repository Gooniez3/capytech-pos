#!/bin/bash
cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH="/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"
export PATH="/usr/local/opt/postgresql@18/bin:/usr/local/opt/postgresql@17/bin:/usr/local/opt/postgresql@16/bin:$PATH"
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
echo "Plug in a USB stick first if you have one."
echo "This backs up only CapyTech POS V2 and also saves a copy inside its folder."
echo

node scripts/backup-shop-v2.mjs
status=$?

echo
read -r -p "Press Return to close..."
exit "$status"
