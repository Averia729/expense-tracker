param(
  [string]$BackupDir
)

$ErrorActionPreference = 'Stop'

$backupFolderName = "$([char]0x8BB0)$([char]0x8D26)$([char]0x5907)$([char]0x4EFD)"
if ([string]::IsNullOrWhiteSpace($BackupDir)) {
  $BackupDir = [IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), $backupFolderName)
}

$storageKey = 'daily-expense-tracker-v1'
$today = Get-Date -Format 'yyyy-MM-dd'
$outputPath = Join-Path $BackupDir "expenses-$today.json"
$latestPath = Join-Path $BackupDir 'expenses-latest.json'
$logPath = Join-Path $BackupDir 'backup-log.txt'

function Write-BackupLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Read-SharedBytes {
  param([string]$Path)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $bytes = New-Object byte[] $stream.Length
    [void]$stream.Read($bytes, 0, $bytes.Length)
    return $bytes
  } finally {
    $stream.Close()
  }
}

function Get-ChromiumStorageFiles {
  $roots = @(
    [IO.Path]::Combine($env:LOCALAPPDATA, 'Google\Chrome\User Data'),
    [IO.Path]::Combine($env:LOCALAPPDATA, 'Microsoft\Edge\User Data'),
    [IO.Path]::Combine($env:LOCALAPPDATA, 'Microsoft\Edge Beta\User Data'),
    [IO.Path]::Combine($env:LOCALAPPDATA, 'Microsoft\Edge SxS\User Data'),
    [IO.Path]::Combine($env:LOCALAPPDATA, 'BraveSoftware\Brave-Browser\User Data'),
    [IO.Path]::Combine($env:LOCALAPPDATA, 'Vivaldi\User Data'),
    [IO.Path]::Combine($env:APPDATA, 'Opera Software\Opera Stable')
  )

  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }

    Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
      ForEach-Object {
        $levelDb = Join-Path $_.FullName 'Local Storage\leveldb'
        if (Test-Path -LiteralPath $levelDb) {
          Get-ChildItem -LiteralPath $levelDb -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -eq '.log' -or $_.Extension -eq '.ldb' }
        }
      }
  }
}

function Get-JsonCandidatesFromText {
  param([string]$Text)

  $candidates = New-Object System.Collections.Generic.List[string]
  $searchFrom = 0

  while ($true) {
    $keyIndex = $Text.IndexOf($storageKey, $searchFrom, [StringComparison]::Ordinal)
    if ($keyIndex -lt 0) { break }

    $windowStart = $keyIndex + $storageKey.Length
    $windowLength = [Math]::Min(500000, $Text.Length - $windowStart)
    if ($windowLength -le 0) { break }

    $window = $Text.Substring($windowStart, $windowLength)
    $arrayStart = $window.IndexOf('[', [StringComparison]::Ordinal)
    if ($arrayStart -ge 0) {
      $depth = 0
      $inString = $false
      $escaped = $false

      for ($i = $arrayStart; $i -lt $window.Length; $i++) {
        $ch = $window[$i]

        if ($inString) {
          if ($escaped) {
            $escaped = $false
          } elseif ($ch -eq '\') {
            $escaped = $true
          } elseif ($ch -eq '"') {
            $inString = $false
          }
          continue
        }

        if ($ch -eq '"') {
          $inString = $true
        } elseif ($ch -eq '[') {
          $depth++
        } elseif ($ch -eq ']') {
          $depth--
          if ($depth -eq 0) {
            $candidates.Add($window.Substring($arrayStart, $i - $arrayStart + 1))
            break
          }
        }
      }
    }

    $searchFrom = $keyIndex + $storageKey.Length
  }

  return $candidates
}

function Get-JsonArrayAtStart {
  param([string]$Text)

  $arrayStart = $Text.IndexOf('[', [StringComparison]::Ordinal)
  if ($arrayStart -lt 0) { return $null }

  $depth = 0
  $inString = $false
  $escaped = $false

  for ($i = $arrayStart; $i -lt $Text.Length; $i++) {
    $ch = $Text[$i]

    if ($inString) {
      if ($escaped) {
        $escaped = $false
      } elseif ($ch -eq '\') {
        $escaped = $true
      } elseif ($ch -eq '"') {
        $inString = $false
      }
      continue
    }

    if ($ch -eq '"') {
      $inString = $true
    } elseif ($ch -eq '[') {
      $depth++
    } elseif ($ch -eq ']') {
      $depth--
      if ($depth -eq 0) {
        return $Text.Substring($arrayStart, $i - $arrayStart + 1)
      }
    }
  }

  return $null
}

function Find-BytePattern {
  param(
    [byte[]]$Bytes,
    [byte[]]$Pattern,
    [int]$StartIndex = 0
  )

  if ($Pattern.Length -eq 0 -or $Bytes.Length -lt $Pattern.Length) { return -1 }

  for ($i = $StartIndex; $i -le $Bytes.Length - $Pattern.Length; $i++) {
    $matched = $true
    for ($j = 0; $j -lt $Pattern.Length; $j++) {
      if ($Bytes[$i + $j] -ne $Pattern[$j]) {
        $matched = $false
        break
      }
    }
    if ($matched) { return $i }
  }

  return -1
}

function Convert-LevelDbBytesToCandidates {
  param([byte[]]$Bytes)

  $keyBytes = [Text.Encoding]::UTF8.GetBytes($storageKey)
  $keyIndex = 0

  while ($true) {
    $keyIndex = Find-BytePattern -Bytes $Bytes -Pattern $keyBytes -StartIndex $keyIndex
    if ($keyIndex -lt 0) { break }

    for ($i = $keyIndex + $keyBytes.Length; $i -lt $Bytes.Length - 1; $i++) {
      if ($Bytes[$i] -eq 0x5B -and $Bytes[$i + 1] -eq 0x00) {
        $unicodeText = [Text.Encoding]::Unicode.GetString($Bytes, $i, $Bytes.Length - $i)
        $candidate = Get-JsonArrayAtStart -Text $unicodeText
        if ($candidate) { $candidate }
        break
      }
    }

    $keyIndex = $keyIndex + $keyBytes.Length
  }

  $texts = @(
    [Text.Encoding]::UTF8.GetString($Bytes),
    [Text.Encoding]::Unicode.GetString($Bytes)
  )

  foreach ($text in $texts) {
    $cleanText = $text.Replace(([char]0).ToString(), '')
    foreach ($candidate in Get-JsonCandidatesFromText -Text $cleanText) {
      $candidate
    }
  }
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$bestJson = $null
$bestSource = $null
$files = Get-ChromiumStorageFiles | Sort-Object LastWriteTimeUtc, FullName

if (-not $files) {
  Write-BackupLog "No Chromium localStorage LevelDB files were readable."
}

foreach ($file in $files) {
  try {
    $bytes = Read-SharedBytes -Path $file.FullName
    foreach ($candidate in Convert-LevelDbBytesToCandidates -Bytes $bytes) {
      try {
        if ($candidate.Contains([char]0xFFFD)) { continue }
        $parsed = $candidate | ConvertFrom-Json
        if ($null -ne $parsed -and $parsed -is [array]) {
          $bestJson = $candidate
          $bestSource = $file.FullName
        }
      } catch {
        continue
      }
    }
  } catch {
    continue
  }
}

if (-not $bestJson) {
  Write-BackupLog "No expense tracker data found after scanning $($files.Count) localStorage files. Open the site in Edge and confirm it has records."
  throw "No expense tracker data found. Open the site in Edge and confirm it has records."
}

$parsedForOutput = ConvertFrom-Json -InputObject $bestJson
$formatted = ConvertTo-Json -InputObject @($parsedForOutput) -Depth 20
Set-Content -LiteralPath $outputPath -Value $formatted -Encoding UTF8
Set-Content -LiteralPath $latestPath -Value $formatted -Encoding UTF8
Write-BackupLog "Backup succeeded: $outputPath; source: $bestSource"

Write-Output "Backup written to $outputPath"
