#!/bin/bash
cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

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
echo "Starting CapyTech POS V2..."
echo "Leave this window open while you sell."
echo

node scripts/start-pos-v2.mjs
status=$?

if [ "$status" -ne 0 ]; then
  echo
  read -r -p "Press Return to close..."
fi

exit "$status"
