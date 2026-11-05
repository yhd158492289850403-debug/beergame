$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$stage = Join-Path $PSScriptRoot 'build/payload'
$vendor = Join-Path $PSScriptRoot 'vendor'
New-Item -ItemType Directory -Force $vendor | Out-Null
if (-not (Test-Path "$vendor/webview2/lib/net462/Microsoft.Web.WebView2.Core.dll")) {
    Invoke-WebRequest 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.3537.50/microsoft.web.webview2.1.0.3537.50.nupkg' -OutFile "$vendor/webview2.zip"
    Expand-Archive -LiteralPath "$vendor/webview2.zip" -DestinationPath "$vendor/webview2" -Force
}
if (-not (Test-Path "$vendor/cloudflared.exe")) {
    Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-windows-amd64.exe' -OutFile "$vendor/cloudflared.exe"
}
$expectedTunnelHash = '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c'
if ((Get-FileHash "$vendor/cloudflared.exe" -Algorithm SHA256).Hash -ne $expectedTunnelHash) { throw 'cloudflared SHA256 不匹配' }
$nodeVersion = & node -p process.version
Invoke-WebRequest "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile "$vendor/Node-LICENSE.txt"
if (-not (Test-Path "$vendor/Cloudflared-LICENSE.txt")) { Invoke-WebRequest 'https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.0/LICENSE' -OutFile "$vendor/Cloudflared-LICENSE.txt" }
New-Item -ItemType Directory -Force $stage, "$stage/src", "$project/dist" | Out-Null
foreach ($file in @('index.html','styles.css','favicon.svg','server.js')) { Copy-Item -LiteralPath (Join-Path $project $file) -Destination $stage -Force }
Get-ChildItem -LiteralPath "$project/src" -Filter '*.js' | Copy-Item -Destination "$stage/src" -Force
Copy-Item -LiteralPath "$PSScriptRoot/boot.js" -Destination $stage -Force
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination "$stage/node.exe" -Force
Copy-Item -LiteralPath "$vendor/cloudflared.exe" -Destination $stage -Force
foreach ($file in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) { Copy-Item -LiteralPath "$vendor/webview2/lib/net462/$file" -Destination $stage -Force }
Copy-Item -LiteralPath "$vendor/webview2/runtimes/win-x64/native/WebView2Loader.dll" -Destination $stage -Force
Get-ChildItem -LiteralPath $vendor -Filter '*LICENSE*' | Copy-Item -Destination $stage -Force
Copy-Item -LiteralPath "$vendor/webview2/LICENSE.txt" -Destination "$stage/WebView2-LICENSE.txt" -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $PSScriptRoot 'build/payload.zip'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$exe = Join-Path $project 'dist/BeerGame.exe'
$exe = [IO.Path]::GetFullPath($exe)
$zip = [IO.Path]::GetFullPath($zip)
$coreDll = [IO.Path]::GetFullPath("$stage/Microsoft.Web.WebView2.Core.dll")
$formsDll = [IO.Path]::GetFullPath("$stage/Microsoft.Web.WebView2.WinForms.dll")
$launcherSource = Join-Path $PSScriptRoot 'Launcher.cs'
$windowSource = Join-Path $PSScriptRoot 'GameWindow.cs'
& $compiler /nologo /utf8output /target:winexe /platform:x64 /optimize+ "/out:$exe" "/resource:$zip,payload.zip" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Net.Http.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "/r:$coreDll" "/r:$formsDll" $launcherSource $windowSource
if ($LASTEXITCODE -ne 0) { throw 'EXE 编译失败' }
Get-Item -LiteralPath $exe | Select-Object FullName,Length
Get-FileHash -LiteralPath $exe -Algorithm SHA256
