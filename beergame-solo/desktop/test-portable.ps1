param([switch]$Internet)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$report = Join-Path $project ('evidence/portable-' + $(if ($Internet) { 'internet' } else { 'local' }) + '.json')
if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report }
$arguments = '--smoke "' + $report + '"' + $(if ($Internet) { ' internet' } else { '' })
$process = Start-Process -FilePath "$project/dist/BeerGame.exe" -ArgumentList $arguments -PassThru -WindowStyle Hidden
try {
    if (-not $process.WaitForExit(240000)) { throw '便携版验证超时' }
    if (-not (Test-Path -LiteralPath $report)) { throw '没有生成验证报告' }
    $result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
    if (-not $result.ok) { throw ($result | ConvertTo-Json -Depth 5) }
    if (Test-Path -LiteralPath $result.temp) { throw "临时目录未清理：$($result.temp)" }
    foreach ($processId in @($result.serverPid,$result.browserPid,$result.childPid,$result.tunnelPid)) {
        if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { throw "进程未退出：$processId" }
    }
    $leftovers = Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($result.temp, [StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.Contains($result.temp)) }
    if ($leftovers) { throw ('发现残留子进程：' + ($leftovers.ProcessId -join ', ')) }
    $socket = [Net.Sockets.TcpClient]::new()
    try { $socket.Connect('127.0.0.1',[int]$result.port); throw '服务端口仍开放' }
    catch [Net.Sockets.SocketException] {} finally { $socket.Dispose() }
    Write-Output ('PASS: EXE 启动、教程、两席位联机结算、' + $(if ($Internet) {'公网网页与房间 API、'} else {''}) + '关闭后进程退出、端口关闭、临时目录删除。')
    Get-Item -LiteralPath "$project/dist/BeerGame.exe" | Select-Object FullName,Length
} finally {
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $process.Dispose()
}
