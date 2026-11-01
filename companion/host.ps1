# MediaPlus 极速下载本地代理（Native Messaging Host）
# 协议：Chrome ↔ 4 字节小端长度 + UTF-8 JSON（stdio）
# 依赖：同目录 bin\yt-dlp.exe（见 README.md）
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ytdlp = Join-Path $dir 'bin\yt-dlp.exe'

function Send-Json($obj) {
  $json = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 5))
  $len = [BitConverter]::GetBytes([UInt32]$json.Length)
  $out = [Console]::OpenStandardOutput()
  $out.Write($len, 0, 4)
  $out.Write($json, 0, $json.Length)
  $out.Flush()
}

function Read-Message {
  $in = [Console]::OpenStandardInput()
  $lenBytes = New-Object byte[] 4
  if ($in.Read($lenBytes, 0, 4) -ne 4) { return $null }
  $len = [BitConverter]::ToUInt32($lenBytes, 0)
  if ($len -le 0 -or $len -gt 10MB) { return $null }
  $body = New-Object byte[] $len
  $read = 0
  while ($read -lt $len) {
    $r = $in.Read($body, $read, $len - $read)
    if ($r -le 0) { return $null }
    $read += $r
  }
  [Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json
}

# 下载目录：用户 Downloads\MediaPlus
$outDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads\MediaPlus'

while ($true) {
  $msg = Read-Message
  if ($null -eq $msg) { break }
  $type = $msg.type

  if ($type -eq 'ping') {
    Send-Json @{ type = 'pong' }
    continue
  }

  if ($type -eq 'download') {
    $reqId = [int]$msg.reqId
    if (-not (Test-Path $ytdlp)) {
      Send-Json @{ type = 'error'; reqId = $reqId; message = '未找到 bin\yt-dlp.exe，请按 README.md 放入后重试' }
      continue
    }
    try { New-Item -ItemType Directory -Force -Path $outDir | Out-Null } catch { }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ytdlp
    $psi.Arguments = "--newline --no-playlist --progress-template `"download:PROGRESS `$(progress._percent_str)`" -P `"$outDir`" `"$($msg.url)`""
    $psi.RedirectStandardOutput = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    try {
      $proc = [System.Diagnostics.Process]::Start($psi)
      while (-not $proc.StandardOutput.EndOfStream) {
        $line = $proc.StandardOutput.ReadLine()
        if ($line -match 'PROGRESS\s+([0-9.]+)%') {
          Send-Json @{ type = 'progress'; reqId = $reqId; pct = [double]($Matches[1] / 100) }
        }
      }
      $proc.WaitForExit()
      if ($proc.ExitCode -eq 0) {
        Send-Json @{ type = 'done'; reqId = $reqId; file = $outDir }
      } else {
        Send-Json @{ type = 'error'; reqId = $reqId; message = "yt-dlp 退出码 $($proc.ExitCode)（可在 Downloads\MediaPlus 查看已完成部分）" }
      }
    } catch {
      Send-Json @{ type = 'error'; reqId = $reqId; message = "启动 yt-dlp 失败: $($_.Exception.Message)" }
    }
    continue
  }
}
