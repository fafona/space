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
  $command = '"' + $NodePath + '" "' + $HelperPath + '" "%1"'
  $protocolKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\faolla-print-helper')
  if (-not $protocolKey) { throw 'launch_protocol_key_create_failed' }
  try {
    $protocolKey.SetValue('', 'URL:FAOLLA Print Helper', [Microsoft.Win32.RegistryValueKind]::String)
    $protocolKey.SetValue('URL Protocol', '', [Microsoft.Win32.RegistryValueKind]::String)
    $commandKey = $protocolKey.CreateSubKey('shell\open\command')
    if (-not $commandKey) { throw 'launch_protocol_command_key_create_failed' }
    try {
      $commandKey.SetValue('', $command, [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
      $commandKey.Close()
    }
  } finally {
    $protocolKey.Close()
  }
  Write-InstallLog 'Launch protocol registered.'
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

function Start-InstalledHelper([string]$InstallDir, [string]$NodePath, [string]$HelperPath) {
  $hiddenScript = Join-Path $InstallDir 'run-hidden.vbs'
  if (Test-Path -LiteralPath $hiddenScript) {
    Start-Process -FilePath 'wscript.exe' -ArgumentList @($hiddenScript) -WorkingDirectory $InstallDir -WindowStyle Hidden
  } else {
    Start-Process -FilePath $NodePath -ArgumentList @($HelperPath) -WorkingDirectory $InstallDir -WindowStyle Hidden
  }

  Start-Sleep -Seconds 2
  try {
    $health = Invoke-WebRequest -Uri 'http://127.0.0.1:17658/health' -UseBasicParsing -TimeoutSec 3
    Write-InstallLog ('Helper health: ' + $health.Content)
  } catch {
    Write-InstallLog 'Helper files are ready, but health check did not respond yet. The helper may still be starting.'
  }
}

function Update-ExistingHelperFiles([string]$HelperPath, [string]$InstallDir) {
  try {
    $manifestUri = [Uri]::new($manifestUrl)
    Assert-FaollaUrl $manifestUri 'manifest'
    $manifestPath = Join-Path $workDir 'latest-existing.json'
    Invoke-WebRequest -Uri $manifestUri -OutFile $manifestPath -UseBasicParsing -TimeoutSec 30
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

    $helperUrlText = [string]$manifest.existingInstallUpdate.helperScriptUrl
    $expectedSha = ([string]$manifest.existingInstallUpdate.helperScriptSha256).Trim().ToLowerInvariant()
    if (-not $helperUrlText -or -not $expectedSha) {
      Write-InstallLog 'No lightweight existing-helper update is listed in the manifest.'
      return $false
    }
    if ([Uri]::IsWellFormedUriString($helperUrlText, [UriKind]::Absolute)) {
      $helperUri = [Uri]::new($helperUrlText)
    } else {
      $helperUri = [Uri]::new($manifestUri, $helperUrlText)
    }
    Assert-FaollaUrl $helperUri 'helper_script'

    $helperDownloadPath = Join-Path $workDir 'faolla-print-helper.mjs'
    Write-InstallLog ('Downloading helper script update: ' + $helperUri.AbsoluteUri)
    Invoke-WebRequest -Uri $helperUri -OutFile $helperDownloadPath -UseBasicParsing -TimeoutSec 60
    $actualSha = (Get-FileHash -LiteralPath $helperDownloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha -ne $expectedSha) { throw 'helper_script_sha256_mismatch' }
    Copy-Item -LiteralPath $helperDownloadPath -Destination $HelperPath -Force
    Write-InstallLog 'Existing helper script updated.'

    $launcherUrlText = [string]$manifest.existingInstallUpdate.launcherScriptUrl
    $launcherExpectedSha = ([string]$manifest.existingInstallUpdate.launcherScriptSha256).Trim().ToLowerInvariant()
    if ($launcherUrlText -and $launcherExpectedSha) {
      if ([Uri]::IsWellFormedUriString($launcherUrlText, [UriKind]::Absolute)) {
        $launcherUri = [Uri]::new($launcherUrlText)
      } else {
        $launcherUri = [Uri]::new($manifestUri, $launcherUrlText)
      }
      Assert-FaollaUrl $launcherUri 'launcher_script'
      $launcherDownloadPath = Join-Path $workDir 'run-hidden.vbs'
      Invoke-WebRequest -Uri $launcherUri -OutFile $launcherDownloadPath -UseBasicParsing -TimeoutSec 30
      $launcherActualSha = (Get-FileHash -LiteralPath $launcherDownloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($launcherActualSha -ne $launcherExpectedSha) { throw 'launcher_script_sha256_mismatch' }
      Copy-Item -LiteralPath $launcherDownloadPath -Destination (Join-Path $InstallDir 'run-hidden.vbs') -Force
      Write-InstallLog 'Existing helper launcher updated.'
    }
    return $true
  } catch {
    Write-InstallLog ('Existing helper script update skipped: ' + $_.Exception.Message)
    return $false
  }
}

try {
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  New-Item -ItemType Directory -Force -Path $workDir | Out-Null
  Write-InstallLog ('Install dir: ' + $installDir)

  $existingNodePath = Join-Path $installDir 'runtime\node.exe'
  $existingHelperPath = Join-Path $installDir 'faolla-print-helper.mjs'
  if ((Test-Path -LiteralPath $existingNodePath) -and (Test-Path -LiteralPath $existingHelperPath)) {
    Write-InstallLog 'Existing helper files found. Repairing launch protocol and starting helper without package download.'
    Stop-ExistingHelper
    [void](Update-ExistingHelperFiles $existingHelperPath $installDir)
    Register-LaunchProtocol $existingNodePath $existingHelperPath
    Enable-Startup $installDir
    Start-InstalledHelper $installDir $existingNodePath $existingHelperPath
    Write-InstallLog 'Existing FAOLLA print helper repaired.'
    exit 0
  }

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
  Start-InstalledHelper $installDir $nodePath $helperPath

  Write-InstallLog 'FAOLLA print helper install completed.'
  exit 0
} catch {
  Write-Host ('Install failed: ' + $_.Exception.Message)
  try { Add-Content -LiteralPath $logPath -Value ('Install failed: ' + $_.Exception.Message) -Encoding UTF8 } catch {}
  exit 1
} finally {
  try { Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}
