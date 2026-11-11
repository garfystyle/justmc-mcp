$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$repo = 'garfystyle/justmc-mcp'
$root = if ($env:JUSTMC_WORKSPACE) { $env:JUSTMC_WORKSPACE } else { Join-Path $HOME '.justmc-mcp' }
$app = Join-Path $root 'app'

function Stop-Install([string]$text) {
    Write-Host $text -ForegroundColor Red
    throw 'justmc-mcp не установлен'
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-Install 'Нужен Node.js 22.13 или новее: https://nodejs.org или winget install OpenJS.NodeJS.LTS'
}
& node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if ($LASTEXITCODE -ne 0) {
    Stop-Install ("Node.js " + (& node -v) + " старый, нужен 22.13 или новее: https://nodejs.org")
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ('justmc-mcp-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    Write-Host "Скачиваю $repo…"
    $zip = Join-Path $temp 'main.zip'
    Invoke-WebRequest "https://github.com/$repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $temp
    $source = Join-Path $temp 'justmc-mcp-main'

    New-Item -ItemType Directory -Force -Path $app | Out-Null
    Get-ChildItem -Path $app -Force | Where-Object { $_.Name -notin @('data', 'node_modules') } | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $source '*') -Destination $app -Recurse -Force

    Push-Location $app
    try {
        Write-Host 'Ставлю зависимости…'
        & npm ci --omit=dev --no-audit --no-fund --update-notifier=false --loglevel=error
        if ($LASTEXITCODE -ne 0) { Stop-Install 'npm ci не прошёл' }
        & node scripts/setup.mjs @args
        if ($LASTEXITCODE -ne 0) { Stop-Install 'настройка не прошла' }
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item -Path $temp -Recurse -Force -ErrorAction SilentlyContinue
}
