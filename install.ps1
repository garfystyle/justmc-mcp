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

function Update-Path {
    $dirs = @($env:Path -split ';')
    foreach ($scope in 'Machine', 'User') {
        try { $dirs += @([Environment]::GetEnvironmentVariable('Path', $scope) -split ';') } catch {}
    }
    foreach ($root in $env:ProgramFiles, ${env:ProgramFiles(x86)}) { if ($root) { $dirs += (Join-Path $root 'nodejs') } }
    if ($env:LOCALAPPDATA) { $dirs += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs') }
    if ($env:NVM_SYMLINK) { $dirs += $env:NVM_SYMLINK }
    $env:Path = (@($dirs | ForEach-Object { "$_".Trim().Trim('"') } | Where-Object { $_ }) | Select-Object -Unique) -join ';'
}

function Get-NpmReason([string[]]$lines) {
    $text = $lines -join "`n"
    $log = @($lines | ForEach-Object { if ($_ -match 'complete log of this run can be found in:\s*(.+)$') { $matches[1].Trim() } }) | Select-Object -Last 1
    if ($log -and (Test-Path -LiteralPath $log)) { try { $text += "`n" + (Get-Content -LiteralPath $log -Raw -ErrorAction Stop) } catch {} }
    if ($text -match 'EPERM|EBUSY|resource busy or locked|operation not permitted') {
        return 'npm ci не прошёл: файлы MCP заняты. Закрой программы с нейросетью, где запущен MCP (и проверь антивирус), потом нажми ещё раз'
    }
    if ($text -match 'ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|socket hang up|tunneling socket|407 Proxy|CERT_|UNABLE_TO_|SELF_SIGNED') {
        return 'npm ci не прошёл: нет связи с registry.npmjs.org. Проверь интернет, VPN или прокси'
    }
    if ($text -match 'ENOSPC') { return 'npm ci не прошёл: на диске кончилось место' }
    if ($text -match 'EACCES') { return 'npm ci не прошёл: нет прав на запись в папку MCP или в кэш npm' }
    if ($text -match 'Exit handler never called') { return 'npm ci оборвался посреди установки, чаще всего из-за связи. Нажми ещё раз' }
    $first = @($lines | Where-Object { $_ -match '^npm (error|ERR!)' } | ForEach-Object { ($_ -replace '^npm (error|ERR!)\s*', '').Trim() } |
        Where-Object { $_ -and $_ -notmatch 'complete log|log of this run|report this error|^<?https?://|^code ' }) | Select-Object -First 1
    if ($first) { return 'npm ci не прошёл: ' + $first }
    return 'npm ci не прошёл'
}

function Stop-Running([string]$dir) {
    $mark = $dir.Replace('/', '\').TrimEnd('\').ToLowerInvariant() + '\'
    try {
        $running = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop |
            Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\').ToLowerInvariant().Contains($mark) })
    } catch {
        return
    }
    if ($running.Count -eq 0) { return }
    Write-Host "Останавливаю запущенный MCP: $($running.Count)"
    foreach ($p in $running) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($p in $running) { Wait-Process -Id $p.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }
}

Update-Path
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
        Stop-Running $app
        Write-Host 'Ставлю зависимости…'
        $npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { 'npm.cmd' } else { 'npm' }
        $was = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $said = @(& $npm ci --omit=dev --no-audit --no-fund --update-notifier=false --loglevel=error 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
        $ErrorActionPreference = $was
        foreach ($line in $said) { Write-Host $line }
        if ($code -ne 0) { Stop-Install (Get-NpmReason $said) }
        & node scripts/setup.mjs @args
        if ($LASTEXITCODE -ne 0) { Stop-Install 'настройка не прошла' }
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item -Path $temp -Recurse -Force -ErrorAction SilentlyContinue
}
