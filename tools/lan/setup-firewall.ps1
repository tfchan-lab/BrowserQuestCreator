# Adds an inbound Windows Firewall rule so other devices on the LAN can reach
# the BrowserQuest server (TCP 8000), and makes sure it applies on every profile.
#
# Run this in an ELEVATED PowerShell (Run as Administrator):
#     powershell -ExecutionPolicy Bypass -File tools\lan\setup-firewall.ps1
#
# Why this is needed: Windows only auto-prompts for firewall access the FIRST time
# a given executable listens. If you previously answered "Cancel"/"Public only",
# or if node is launched from a different path than the one that was allowed
# (e.g. nvm switching between C:\nvm4w\nodejs\ and versioned paths), the prompt
# never re-appears and LAN devices are silently blocked.

$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: This script must be run as Administrator." -ForegroundColor Red
    Write-Host "Right-click PowerShell -> 'Run as administrator', then run again." -ForegroundColor Yellow
    exit 1
}

$port = 8000
$ruleName = "BrowserQuest TCP $port"

# Resolve the node executable that `node` actually points to right now.
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCmd) { $nodeCmd.Source } else { $null }
if ($nodePath) { Write-Host "Detected node: $nodePath" } else { Write-Host "WARN: 'node' not found on PATH; adding a port-only rule." -ForegroundColor Yellow }

# Remove any stale rule with our name, then (re)create it.
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue

if ($nodePath) {
    New-NetFirewallRule -DisplayName $ruleName `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port `
        -Program $nodePath -Profile Private, Domain, Public `
        -Description "Allow LAN devices to reach the BrowserQuest server on TCP $port" | Out-Null
} else {
    New-NetFirewallRule -DisplayName $ruleName `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port `
        -Profile Private, Domain, Public `
        -Description "Allow LAN devices to reach the BrowserQuest server on TCP $port" | Out-Null
}

Write-Host "Created firewall rule '$ruleName' (inbound TCP $port) for Private/Domain/Public." -ForegroundColor Green

# If the Wi-Fi network is categorised as Public, briefly warn about campus/guest
# networks that enforce client isolation (device-to-device traffic is blocked by
# the access point regardless of this firewall rule).
Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.NetworkCategory -eq 'Public') {
        Write-Host ("NOTE: network '{0}' is 'Public'. If it is a campus/guest Wi-Fi, " -f $_.Name) -ForegroundColor Yellow
        Write-Host "      the access point may block device-to-device traffic (client isolation)." -ForegroundColor Yellow
        Write-Host "      Use a personal/home Wi-Fi or a mobile hotspot if so." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done. Keep the server running (npm start) and open the 'Play on LAN' URL" -ForegroundColor Green
Write-Host "printed by the server from the other device." -ForegroundColor Green
