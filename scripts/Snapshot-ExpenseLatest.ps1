param(
  [string]$BackupDir
)

$ErrorActionPreference = 'Stop'

$backupFolderName = "$([char]0x8BB0)$([char]0x8D26)$([char]0x5907)$([char]0x4EFD)"
if ([string]::IsNullOrWhiteSpace($BackupDir)) {
  $BackupDir = [IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), $backupFolderName)
}

$today = Get-Date -Format 'yyyy-MM-dd'
$latestPath = Join-Path $BackupDir 'expenses-latest.json'
$outputPath = Join-Path $BackupDir "expenses-$today.json"
$logPath = Join-Path $BackupDir 'backup-log.txt'

function Write-BackupLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

if (-not (Test-Path -LiteralPath $latestPath)) {
  Write-BackupLog "Daily snapshot failed: expenses-latest.json does not exist."
  throw "expenses-latest.json does not exist."
}

Copy-Item -LiteralPath $latestPath -Destination $outputPath -Force
(Get-Item -LiteralPath $outputPath).LastWriteTime = Get-Date
Write-BackupLog "Daily snapshot succeeded: $outputPath"
Write-Output "Snapshot written to $outputPath"
