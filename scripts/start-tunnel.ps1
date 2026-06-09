$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Cloudflared = Join-Path $Root "tools\cloudflared.exe"
$LocalPort = if ($env:PORT) { $env:PORT } else { "7317" }
$LocalUrl = "http://localhost:$LocalPort"

if (!(Test-Path $Cloudflared)) {
  Write-Error "cloudflared.exe not found. Expected: $Cloudflared"
}

try {
  Invoke-RestMethod -Uri "$LocalUrl/api/health" -TimeoutSec 3 | Out-Null
} catch {
  Write-Host "Local service is not reachable at $LocalUrl"
  Write-Host "Open another PowerShell and run:"
  Write-Host "  cd $Root"
  Write-Host "  npm run dev"
  exit 1
}

Write-Host "Starting Cloudflare Tunnel for $LocalUrl"
Write-Host "Copy the generated https://*.trycloudflare.com URL."
Write-Host "Feishu callback URL should be:"
Write-Host "  https://YOUR-TUNNEL.trycloudflare.com/api/feishu/events"
Write-Host ""

& $Cloudflared tunnel --url $LocalUrl
