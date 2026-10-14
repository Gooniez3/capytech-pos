#!/bin/bash
cd "$(dirname "$0")" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
export PATH="/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"
export PATH="/usr/local/opt/postgresql@18/bin:$PATH"
export PATH="/usr/local/opt/postgresql@17/bin:/usr/local/opt/postgresql@16/bin:$PATH"
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

echo
echo "========================================"
echo "  Install CapyTech POS V2"
echo "========================================"
echo
echo "This creates a separate EMPTY V2 shop."
echo "The original CapyTech POS folder and pos_store database are not changed."
echo "Do not import or restore the original shop database into V2."
echo

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is not installed yet."
  echo "Open Terminal and paste:"
  echo
  echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  echo
  echo "Then double-click this file again."
  echo
  read -r -p "Press Return to close..."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js..."
  brew install node || exit 1
fi

node scripts/install-shop-v2.mjs --install-tools
status=$?

echo
read -r -p "Press Return to close..."
exit "$status"
