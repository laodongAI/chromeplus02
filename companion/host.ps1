# MediaPlus 极速下载本地代理（Native Messaging Host）
# 协议：Chrome ↔ 4 字节小端长度 + UTF-8 JSON（stdio）
# 依赖：同目录 bin\yt-dlp.exe（见 README.md）
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ytdlp = Join-Path $dir 'bin\yt-dlp.exe'
$binDir = Join-Path $dir 'bin'

# ── 外挂下载器（Round 5 #30）─────────────────────────────────────────────
# 扩展侧只下发 argv 数组，本脚本负责启动进程。Windows PowerShell 5.1 跑在
# .NET Framework 上，没有 ProcessStartInfo.ArgumentList，只能自己拼 Arguments；
# 因此必须按 CommandLineToArgvW 规则转义（反斜杠在引号前要翻倍），
# 否则 URL 里的引号/空格会被解析成额外参数——等于命令注入。
function Find-Tool([string]$tool) {
  $names = switch ($tool) {
    'm3u8dl' { @('N_m3u8DL-RE.exe', 'm3u8DL-RE.exe', 'm3u8dl.exe') }
    'ffmpeg' { @('ffmpeg.exe') }
    default  { @() }
  }
  foreach ($n in $names) {
    $p = Join-Path $binDir $n
    if (Test-Path -LiteralPath $p) { return $p }
  }
  # PATH 里已安装的工具也认（用户可能用 winget/scoop 装过）
  foreach ($n in $names) {
    $cmd = Get-Command $n -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

# 转义目标是「两套解析规则都同意」，而不是某一套：
#   ffmpeg.exe 走 MSVC CRT 规则，m3u8DL-RE(.NET) 走 shell32!CommandLineToArgvW 规则。
#   实测两者对引号内的 \" 解释相反（CRT 当字面引号，CommandLineToArgvW 当结束引号），
#   对「结尾反斜杠 + 结束引号」也不同（CRT 折半，CommandLineToArgvW 原样保留）。
# 所以这里不发明转义，而是拒绝无法两全的参数，剩下的直接包引号：
#   - 双引号：无解，拒绝；
#   - 含空白又以 \ 结尾：两解不同，拒绝；
#   - 其余（含 CRLF，ffmpeg -headers 需要）：引号内两套都按字面处理，安全。
# 不走 shell（UseShellExecute=$false），所以 & | $() 反引号都只是普通字符。
function Quote-Arg([string]$arg) {
  if ($null -eq $arg -or $arg.Length -eq 0) { return '""' }
  if ($arg.IndexOf('"') -ge 0) { throw '参数含双引号，两套命令行解析规则无法同时满足，已拒绝执行' }
  if (($arg -match '\s') -and $arg.EndsWith('\')) { throw '参数含空白且以反斜杠结尾，两套解析规则结果不一致，已拒绝执行' }
  if ($arg -notmatch '\s') { return $arg }
  return '"' + $arg + '"'
}

# 参数名不能叫 $args：它是 PowerShell 自动变量，声明为形参也永远绑不上值（会静默变成空命令行）
function Build-ArgLine([string[]]$argList) {
  return (($argList | ForEach-Object { Quote-Arg $_ }) -join ' ')
}

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

# ── 桌面标注层控制 ──────────────────────────────────────────────────────
# 标注层由同目录 overlay\overlay.ps1 实现：一个覆盖整个桌面的透明分层窗口，
# 支持画笔/荧光/橡皮/文字/白板，快捷键 Ctrl+Alt+D/T/Z/X/Q。
$script:overlayScript = Join-Path $dir 'overlay\overlay.ps1'
$script:overlayProc = $null   # 当前标注层进程（同一时间只保留一个）

<#
.SYNOPSIS
    判断标注层进程是否仍在运行。
#>
function Test-OverlayRunning {
  if ($null -eq $script:overlayProc) { return $false }
  try { return (-not $script:overlayProc.HasExited) } catch { return $false }
}

<#
.SYNOPSIS
    启动桌面标注层（已在运行则复用现有进程）。
.DESCRIPTION
    使用独立 powershell 进程 + 隐藏窗口运行 overlay.ps1；
    overlay.ps1 内部还有互斥量兜底，重复启动不会产生两层叠加。
#>
function Start-DesktopOverlay {
  if (Test-OverlayRunning) {
    return @{ ok = $true; running = $true; reused = $true; pid = $script:overlayProc.Id }
  }
  if (-not (Test-Path -LiteralPath $script:overlayScript)) {
    return @{ ok = $false; error = '未找到 overlay\overlay.ps1，请重新运行 install.bat' }
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'powershell.exe'
  $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script:overlayScript`""
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  try {
    $script:overlayProc = [System.Diagnostics.Process]::Start($psi)
    return @{ ok = $true; running = $true; reused = $false; pid = $script:overlayProc.Id }
  } catch {
    $script:overlayProc = $null
    return @{ ok = $false; error = "启动桌面标注失败: $($_.Exception.Message)" }
  }
}

<#
.SYNOPSIS
    停止桌面标注层（已退出则视为成功）。
#>
function Stop-DesktopOverlay {
  if (-not (Test-OverlayRunning)) {
    $script:overlayProc = $null
    return @{ ok = $true; running = $false; stopped = $false }
  }
  try {
    $script:overlayProc.Kill()
    [void]$script:overlayProc.WaitForExit(3000)
    $script:overlayProc = $null
    return @{ ok = $true; running = $false; stopped = $true }
  } catch {
    return @{ ok = $false; error = "停止桌面标注失败: $($_.Exception.Message)" }
  }
}

while ($true) {
  $msg = Read-Message
  if ($null -eq $msg) { break }
  $type = $msg.type

  if ($type -eq 'ping') {
    # 附带标注层运行状态，侧栏可据此同步按钮显示
    Send-Json @{ type = 'pong'; overlay = (Test-OverlayRunning) }
    continue
  }

  # ── 桌面标注：启动 ────────────────────────────────────────────────────
  if ($type -eq 'overlay_start') {
    $reqId = [int]$msg.reqId
    $r = Start-DesktopOverlay
    if ($r.ok) {
      Send-Json @{ type = 'overlay_started'; reqId = $reqId; ok = $true; running = $true; pid = $r.pid; reused = $r.reused }
    } else {
      Send-Json @{ type = 'error'; reqId = $reqId; message = $r.error }
    }
    continue
  }

  # ── 桌面标注：停止 ────────────────────────────────────────────────────
  if ($type -eq 'overlay_stop') {
    $reqId = [int]$msg.reqId
    $r = Stop-DesktopOverlay
    if ($r.ok) {
      Send-Json @{ type = 'overlay_stopped'; reqId = $reqId; ok = $true; running = $false; stopped = $r.stopped }
    } else {
      Send-Json @{ type = 'error'; reqId = $reqId; message = $r.error }
    }
    continue
  }

  # ── 桌面标注：状态查询 ────────────────────────────────────────────────
  if ($type -eq 'overlay_status') {
    $reqId = [int]$msg.reqId
    Send-Json @{ type = 'overlay_state'; reqId = $reqId; ok = $true; running = (Test-OverlayRunning) }
    continue
  }

  # ── 外挂工具探测：扩展设置页据此显示"本机工具是否就绪" ────────────────
  if ($type -eq 'tools_probe') {
    $reqId = [int]$msg.reqId
    Send-Json @{
      type = 'ext_result'; reqId = $reqId; ok = $true
      available = @{
        ytDlp = (Test-Path -LiteralPath $ytdlp)
        m3u8dl = [bool](Find-Tool 'm3u8dl')
        ffmpeg = [bool](Find-Tool 'ffmpeg')
      }
    }
    continue
  }

  # ── 外挂工具下载：argv 由扩展侧构造，这里只负责转义与启动 ──────────────
  if ($type -eq 'download_ext') {
    $reqId = [int]$msg.reqId
    $tool = [string]$msg.tool
    if ($tool -ne 'm3u8dl' -and $tool -ne 'ffmpeg') {
      Send-Json @{ type = 'error'; reqId = $reqId; message = "不支持的外挂工具: $tool" }
      continue
    }
    $url = [string]$msg.url
    if ($url -notmatch '^https?://') {
      Send-Json @{ type = 'error'; reqId = $reqId; message = '外挂工具只接受 http/https 地址' }
      continue
    }
    $exe = Find-Tool $tool
    if (-not $exe) {
      $hint = if ($tool -eq 'm3u8dl') { 'N_m3u8DL-RE.exe' } else { 'ffmpeg.exe' }
      Send-Json @{ type = 'error'; reqId = $reqId; message = "未找到 $hint，请放入 companion\bin 或加入 PATH" }
      continue
    }
    try { New-Item -ItemType Directory -Force -Path $outDir | Out-Null } catch { }
    try {
      $argLine = Build-ArgLine ([string[]]$msg.args)
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = $exe
      $psi.Arguments = $argLine
      # 产物落在固定目录：ffmpeg 的输出名是相对路径，必须设工作目录
      $psi.WorkingDirectory = $outDir
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      $proc = [System.Diagnostics.Process]::Start($psi)
      $errLines = New-Object System.Collections.Generic.List[string]
      # 异步读 stderr，避免管道写满导致子进程阻塞（ffmpeg 的报错都走 stderr）
      $errTask = $proc.StandardError.ReadToEndAsync()
      while (-not $proc.StandardOutput.EndOfStream) {
        $line = $proc.StandardOutput.ReadLine()
        # m3u8DL-RE 输出形如 " 12.34%"；ffmpeg 用 -loglevel error 几乎无输出，进度按不确定处理
        if ($line -match '([0-9]+(?:\.[0-9]+)?)\s*%') {
          Send-Json @{ type = 'progress'; reqId = $reqId; pct = [double]($Matches[1] / 100) }
        }
      }
      $proc.WaitForExit()
      if ($proc.ExitCode -eq 0) {
        Send-Json @{ type = 'done'; reqId = $reqId; file = $outDir; tool = $tool }
      } else {
        $errText = $errTask.Result
        if ($errText) { $errLines.Add($errText) }
        $tail = ($errLines -join ' ').Trim()
        if ($tail.Length -gt 300) { $tail = $tail.Substring($tail.Length - 300) }
        Send-Json @{ type = 'error'; reqId = $reqId; message = "$tool 退出码 $($proc.ExitCode)：$tail" }
      }
    } catch {
      Send-Json @{ type = 'error'; reqId = $reqId; message = "启动 $tool 失败: $($_.Exception.Message)" }
    }
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
