#!/bin/zsh
cd "${0:A:h}"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it from https://bun.sh, then run this file again."
  open https://bun.sh
  read "?Press Enter to close..."
  exit 1
fi

if [[ ! -f .env ]] || ! grep -q '^GOOGLE_MAPS_API_KEY=.' .env || grep -q 'your_google_places_api_key' .env; then
  echo "First-time setup"
  echo "Create a Google Places API key: https://console.cloud.google.com/google/maps-apis/credentials"
  read -s "API_KEY?Paste your Google Places API key (hidden): "
  echo
  if [[ -z "$API_KEY" ]]; then
    echo "No key entered. Nothing was saved."
    read "?Press Enter to close..."
    exit 1
  fi
  printf 'GOOGLE_MAPS_API_KEY=%s\n' "$API_KEY" > .env
  unset API_KEY
fi

bun install
(sleep 2; open http://localhost:5173) &
bun run dev
