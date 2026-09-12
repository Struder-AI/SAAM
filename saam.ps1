# Run from a trusted SAAM folder. No system installs or persistent PATH changes.
$CommandArgs = @($args)
$ErrorActionPreference = 'Stop'
$saamRoot = $PSScriptRoot
if (!$CommandArgs -or $CommandArgs.Count -eq 0) { $CommandArgs = @('setup') }
$action = $CommandArgs[0]
$rest = @($CommandArgs | Select-Object -Skip 1)
if ($action -notin @('setup','studio','node','npm')) { throw 'Usage: saam.ps1 setup [--force] | studio [print-directory] | node <script> [args] | npm <args>' }
if ($action -eq 'studio' -and ($rest.Count -gt 1 -or ($rest.Count -eq 1 -and $rest[0].StartsWith('-')))) { throw 'Studio accepts only one print directory.' }
$saamArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$saamArch = switch ($saamArch) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { throw "Unsupported Windows architecture: $saamArch" } }
$row = @(Get-Content -LiteralPath (Join-Path $saamRoot 'scripts/runtime.tsv') | Where-Object { $_ -match "^\S+ win32 $saamArch " })
if ($row.Count -ne 1) { throw "No pinned Node runtime for Windows $saamArch." }
$version,$platform,$arch,$archive,$sha256 = $row[0] -split '\s+'
$saamRuntime = Join-Path $saamRoot "runtime/node-v$version-win-$arch"
$saamNode = Join-Path $saamRuntime 'node.exe'
if (!(Test-Path -LiteralPath $saamNode)) {
    if ($action -ne 'setup') { throw 'Run .\saam.ps1 setup once before using SAAM.' }
    $runtimeRoot = Join-Path $saamRoot 'runtime'
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
    $downloadDir = Join-Path $runtimeRoot ('.download-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $downloadDir | Out-Null
    try {
        Write-Host "Preparing SAAM: downloading Node $version for Windows $arch..."
        $download = Join-Path $downloadDir $archive
        $oldProgress = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
        try { Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$version/$archive" -OutFile $download } finally { $ProgressPreference = $oldProgress }
        $hasher = [Security.Cryptography.SHA256]::Create()
        $stream = [IO.File]::OpenRead($download)
        try { $actual = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $hasher.Dispose() }
        if ($actual -ne $sha256) { throw 'Node archive checksum mismatch. Run setup again to retry.' }
        Write-Host 'Preparing SAAM: extracting the verified runtime...'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($download, $downloadDir)
        Move-Item -LiteralPath (Join-Path $downloadDir "node-v$version-win-$arch") -Destination $saamRuntime
    } finally {
        $resolvedDownload = [IO.Path]::GetFullPath($downloadDir)
        $resolvedRuntime = [IO.Path]::GetFullPath($runtimeRoot) + [IO.Path]::DirectorySeparatorChar
        if (!$resolvedDownload.StartsWith($resolvedRuntime,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid runtime cleanup path.' }
        Remove-Item -LiteralPath $resolvedDownload -Recurse -Force
    }
}
$oldPath = $env:PATH
Push-Location -LiteralPath $saamRoot
try {
    $env:PATH = $saamRuntime + [IO.Path]::PathSeparator + $oldPath
    switch ($action) {
        'setup' { & $saamNode scripts/setup.mjs @rest }
        'studio' { & $saamNode studio/server.mjs @rest }
        'node' { & $saamNode @rest }
        'npm' { & $saamNode (Join-Path $saamRuntime 'node_modules/npm/bin/npm-cli.js') @rest }
    }
    $saamExit = $LASTEXITCODE
} finally { $env:PATH = $oldPath; Pop-Location }
exit $saamExit
