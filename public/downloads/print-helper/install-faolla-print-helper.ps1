$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$manifestUrl = 'https://faolla.com/downloads/print-helper/latest.json'
$rootDir = Join-Path $env:SystemDrive 'FAOLLA'
$helperFolder = -join ([char[]](0x6253, 0x5370, 0x52a9, 0x624b))
$installDir = Join-Path $rootDir $helperFolder
$workDir = Join-Path $env:TEMP ('faolla-print-helper-install-' + [Guid]::NewGuid().ToString('N'))
$logPath = Join-Path $installDir 'faolla-print-helper-install.log'

function Write-InstallLog([string]$Message) {
  $line = ((Get-Date).ToString('s') + ' ' + $Message)
  Write-Host $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Assert-FaollaUrl([Uri]$Uri, [string]$Name) {
  if ($Uri.Scheme -ne 'https' -and -not ($Uri.Scheme -eq 'http' -and ($Uri.Host -eq 'localhost' -or $Uri.Host -eq '127.0.0.1'))) {
    throw ($Name + '_scheme_not_allowed')
  }
  if ($Uri.Scheme -eq 'https' -and -not ($Uri.Host -eq 'faolla.com' -or $Uri.Host.EndsWith('.faolla.com'))) {
    throw ($Name + '_host_not_allowed')
  }
}

function Stop-ExistingHelper {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { ([string]$_.CommandLine) -like '*faolla-print-helper.mjs*' } |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      } catch {}
    }
}

function Register-LaunchProtocol([string]$NodePath, [string]$HelperPath) {
  $protocolKey = 'HKCU:\Software\Classes\faolla-print-helper'
  $commandKey = Join-Path $protocolKey 'shell\open\command'
  New-Item -Path $commandKey -Force | Out-Null
  Set-ItemProperty -Path $protocolKey -Name '(default)' -Value 'URL:FAOLLA Print Helper'
  New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  $command = '"' + $NodePath + '" "' + $HelperPath + '" "%1"'
  Set-ItemProperty -Path $commandKey -Name '(default)' -Value $command
}

function Enable-Startup([string]$InstallDir) {
  $hiddenScript = Join-Path $InstallDir 'run-hidden.vbs'
  if (-not (Test-Path -LiteralPath $hiddenScript)) { return }
  $startupDir = [Environment]::GetFolderPath('Startup')
  $shortcutPath = Join-Path $startupDir 'FAOLLA-Print-Helper.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = 'wscript.exe'
  $shortcut.Arguments = '"' + $hiddenScript + '"'
  $shortcut.WorkingDirectory = $InstallDir
  $shortcut.Description = 'FAOLLA local silent print helper'
  $shortcut.Save()
}

try {
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  New-Item -ItemType Directory -Force -Path $workDir | Out-Null
  Write-InstallLog ('Install dir: ' + $installDir)

  $manifestUri = [Uri]::new($manifestUrl)
  Assert-FaollaUrl $manifestUri 'manifest'
  $manifestPath = Join-Path $workDir 'latest.json'
  Invoke-WebRequest -Uri $manifestUri -OutFile $manifestPath -UseBasicParsing
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

  $packageUrlText = [string]$manifest.package.url
  if (-not $packageUrlText) { throw 'package_url_missing' }
  if ([Uri]::IsWellFormedUriString($packageUrlText, [UriKind]::Absolute)) {
    $packageUri = [Uri]::new($packageUrlText)
  } else {
    $packageUri = [Uri]::new($manifestUri, $packageUrlText)
  }
  Assert-FaollaUrl $packageUri 'package'

  $expectedSha = ([string]$manifest.package.sha256).Trim().ToLowerInvariant()
  if (-not $expectedSha) { throw 'package_sha256_missing' }
  $zipPath = Join-Path $workDir 'faolla-print-helper.zip'
  Write-InstallLog ('Downloading package: ' + $packageUri.AbsoluteUri)
  Invoke-WebRequest -Uri $packageUri -OutFile $zipPath -UseBasicParsing
  $actualSha = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha -ne $expectedSha) { throw 'package_sha256_mismatch' }

  $extractDir = Join-Path $workDir 'extract'
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
  $sourceDir = $extractDir
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'faolla-print-helper.mjs'))) {
    $candidate = Get-ChildItem -LiteralPath $extractDir -Directory -Force | Where-Object {
      Test-Path -LiteralPath (Join-Path $_.FullName 'faolla-print-helper.mjs')
    } | Select-Object -First 1
    if ($candidate) { $sourceDir = $candidate.FullName }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'faolla-print-helper.mjs'))) {
    throw 'package_layout_invalid'
  }

  Stop-ExistingHelper
  Get-ChildItem -LiteralPath $sourceDir -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $installDir -Recurse -Force
  }

  $nodePath = Join-Path $installDir 'runtime\node.exe'
  $helperPath = Join-Path $installDir 'faolla-print-helper.mjs'
  if (-not (Test-Path -LiteralPath $nodePath)) { throw 'node_runtime_missing' }
  if (-not (Test-Path -LiteralPath $helperPath)) { throw 'helper_script_missing' }

  Register-LaunchProtocol $nodePath $helperPath
  Enable-Startup $installDir

  $hiddenScript = Join-Path $installDir 'run-hidden.vbs'
  if (Test-Path -LiteralPath $hiddenScript) {
    Start-Process -FilePath 'wscript.exe' -ArgumentList @($hiddenScript) -WorkingDirectory $installDir -WindowStyle Hidden
  } else {
    Start-Process -FilePath $nodePath -ArgumentList @($helperPath) -WorkingDirectory $installDir -WindowStyle Hidden
  }

  Start-Sleep -Seconds 2
  try {
    $health = Invoke-WebRequest -Uri 'http://127.0.0.1:17658/health' -UseBasicParsing -TimeoutSec 3
    Write-InstallLog ('Helper health: ' + $health.Content)
  } catch {
    Write-InstallLog 'Helper installed, but health check did not respond yet. It may still be starting.'
  }

  Write-InstallLog 'FAOLLA print helper install completed.'
  exit 0
} catch {
  Write-Host ('Install failed: ' + $_.Exception.Message)
  try { Add-Content -LiteralPath $logPath -Value ('Install failed: ' + $_.Exception.Message) -Encoding UTF8 } catch {}
  exit 1
} finally {
  try { Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}
