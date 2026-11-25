#!/bin/sh
set -eu

REPO=garfystyle/justmc-mcp
ROOT="${JUSTMC_WORKSPACE:-$HOME/.justmc-mcp}"
APP="$ROOT/app"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

NVM_NODE=""
for dir in "$HOME"/.nvm/versions/node/*/bin; do
  if [ -x "$dir/node" ]; then NVM_NODE="$dir"; fi
done
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin${NVM_NODE:+:$NVM_NODE}"
export PATH

npm_reason() {
  log="$1"
  more=$(sed -n 's/.*complete log of this run can be found in:[[:space:]]*//p' "$log" | tail -n 1)
  [ -n "$more" ] && [ -f "$more" ] || more=""
  said() { grep -Eqs "$1" "$log" || { [ -n "$more" ] && grep -Eqs "$1" "$more"; }; }
  if said 'EPERM|EBUSY|resource busy or locked|operation not permitted'; then
    echo "npm ci не прошёл: файлы MCP заняты. Закрой программы с нейросетью, где запущен MCP, потом нажми ещё раз"
  elif said 'ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|socket hang up|tunneling socket|407 Proxy|CERT_|UNABLE_TO_|SELF_SIGNED'; then
    echo "npm ci не прошёл: нет связи с registry.npmjs.org. Проверь интернет, VPN или прокси"
  elif said 'ENOSPC'; then
    echo "npm ci не прошёл: на диске кончилось место"
  elif said 'EACCES'; then
    echo "npm ci не прошёл: нет прав на запись в папку MCP или в кэш npm (~/.npm)"
  elif said 'Exit handler never called'; then
    echo "npm ci оборвался посреди установки, чаще всего из-за связи. Нажми ещё раз"
  else
    first=$(sed -E -n 's/^npm (error|ERR!)[[:space:]]*//p' "$log" | grep -Ev 'complete log|log of this run|report this error|^<?https?://|^code |^$' | head -n 1)
    echo "npm ci не прошёл${first:+: $first}"
  fi
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
LOG="$TEMP/npm.log"
if ! npm ci --omit=dev --no-audit --no-fund --update-notifier=false --loglevel=error >"$LOG" 2>&1; then
  cat "$LOG"
  fail "$(npm_reason "$LOG")"
fi
cat "$LOG"
node scripts/setup.mjs "$@" || fail "настройка не прошла"
