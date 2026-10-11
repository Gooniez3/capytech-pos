#!/bin/bash
set -u

release_root="$(cd "$(dirname "$0")" && pwd)" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

echo
echo "========================================"
echo "  Update CapyTech POS safely"
echo "========================================"
echo
echo "This must be run from a separate, reviewed update folder."
echo "It never runs Install or Prepare Customer Shop."
echo
printf "Drag the EXISTING CapyTech POS folder here, then press Return: "
IFS= read -r current_root
current_root="${current_root#\'}"
current_root="${current_root%\'}"
current_root="${current_root#\"}"
current_root="${current_root%\"}"
current_root="${current_root//\\ / }"

if [ -z "$current_root" ]; then
  echo "No existing installation selected. Nothing changed."
  read -r -p "Press Return to close..."
  exit 1
fi

node "$release_root/scripts/update-shop.mjs" --current "$current_root"
status=$?

echo
read -r -p "Press Return to close..."
exit "$status"
