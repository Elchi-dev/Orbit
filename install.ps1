# Orbit installer for Windows.
#   irm https://raw.githubusercontent.com/Elchi-dev/Orbit/main/install.ps1 | iex
$ErrorActionPreference = "Stop"
$Repo = if ($env:ORBIT_REPO) { $env:ORBIT_REPO } else { "Elchi-dev/Orbit" }
$Version = if ($env:ORBIT_VERSION) { $env:ORBIT_VERSION } else { "latest" }
$Dir = if ($env:ORBIT_INSTALL_DIR) { $env:ORBIT_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\Orbit" }

$Asset = "orbit-windows-x64.exe"
$Base = if ($Version -eq "latest") { "https://github.com/$Repo/releases/latest/download" } else { "https://github.com/$Repo/releases/download/$Version" }

Write-Host "`n  Installing Orbit ($Asset, $Version)`n"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Target = Join-Path $Dir "orbit.exe"
$Tmp = "$Target.download"
Invoke-WebRequest -Uri "$Base/$Asset" -OutFile $Tmp -UseBasicParsing

try {
  $Sums = (Invoke-WebRequest -Uri "$Base/SHA256SUMS" -UseBasicParsing).Content
  $Line = ($Sums -split "`n") | Where-Object { $_ -match " $Asset$" }
  if ($Line) {
    $Expected = ($Line -split "\s+")[0]
    $Actual = (Get-FileHash $Tmp -Algorithm SHA256).Hash.ToLower()
    if ($Expected -ne $Actual) { Remove-Item $Tmp; throw "checksum mismatch, not installing" }
    Write-Host "  checksum ok"
  }
} catch [System.Net.WebException] { }

Move-Item -Force $Tmp $Target
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$Dir*") {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$Dir", "User")
  Write-Host "  added $Dir to your PATH (open a new terminal)"
}
Write-Host "`n  Run  orbit  and open http://localhost:7777`n"
