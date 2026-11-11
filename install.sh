#!/bin/sh
set -eu

REPO=garfystyle/justmc-mcp
ROOT="${JUSTMC_WORKSPACE:-$HOME/.justmc-mcp}"
APP="$ROOT/app"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Нужен Node.js 22.13 или новее: https://nodejs.org"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || fail "Node.js $(node -v) старый, нужен 22.13 или новее: https://nodejs.org"
command -v npm >/dev/null 2>&1 || fail "Нет npm: поставь Node.js с https://nodejs.org"

TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT INT TERM

echo "Скачиваю $REPO…"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$TEMP"
else
  wget -qO- "https://github.com/$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$TEMP"
fi

mkdir -p "$APP"
find "$APP" -mindepth 1 -maxdepth 1 ! -name data ! -name node_modules -exec rm -rf {} +
cp -R "$TEMP/justmc-mcp-main/." "$APP/"

cd "$APP"
echo "Ставлю зависимости…"
npm ci --omit=dev --no-audit --no-fund --update-notifier=false --loglevel=error
node scripts/setup.mjs "$@"
