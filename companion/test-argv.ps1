$ErrorActionPreference = 'Stop'
# 校验 host.ps1 的命令行转义：必须同时满足两套解析规则
#   oracle A = shell32!CommandLineToArgvW（m3u8DL-RE / .NET 走这条）
#   oracle B = MSVC CRT 规则（ffmpeg.exe 走这条）
# 两者对引号内 \" 与结尾反斜杠的解释相反，所以只接受两边都能还原的参数。
$hostPath = Join-Path $PSScriptRoot 'host.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($hostPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'host.ps1 parse failed' }

# 只取出纯函数，不执行 host 的消息循环
foreach ($name in @('Quote-Arg', 'Build-ArgLine', 'Test-SafeRemoteUrl')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "function not found: $name" }
  Invoke-Expression $fn.Extent.Text
}

Add-Type -Namespace Win32 -Name Argv -MemberDefinition @'
[DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="CommandLineToArgvW")]
public static extern IntPtr CommandLineToArgvW(string lpCmdLine, out int pNumArgs);
[DllImport("kernel32.dll")]
public static extern IntPtr LocalFree(IntPtr hMem);
'@

function Parse-ArgvW([string]$line) {
  $n = 0
  $ptr = [Win32.Argv]::CommandLineToArgvW($line, [ref]$n)
  if ($ptr -eq [IntPtr]::Zero) { throw 'CommandLineToArgvW failed' }
  $out = @()
  for ($i = 0; $i -lt $n; $i++) {
    $out += [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::ReadIntPtr($ptr, $i * [IntPtr]::Size))
  }
  [void][Win32.Argv]::LocalFree($ptr)
  return , $out
}

# MSVC CRT 规则：2n 个反斜杠 + 引号 -> n 个反斜杠 + 切换引号态；
# 2n+1 个 -> n 个反斜杠 + 字面引号；不跟引号的反斜杠一律字面。
function Parse-Crt([string]$line) {
  $list = @()
  $cur = New-Object System.Text.StringBuilder
  $inQuotes = $false
  $hasToken = $false
  $i = 0
  while ($i -lt $line.Length) {
    $ch = $line[$i]
    if ($ch -eq '\') {
      $n = 0
      while ($i -lt $line.Length -and $line[$i] -eq '\') { $n++; $i++ }
      if ($i -lt $line.Length -and $line[$i] -eq '"') {
        [void]$cur.Append(('\' * [int][Math]::Floor($n / 2)))
        if ($n % 2 -eq 1) { [void]$cur.Append('"') } else { $inQuotes = -not $inQuotes }
        $hasToken = $true; $i++
      } else {
        [void]$cur.Append(('\' * $n)); $hasToken = $true
      }
      continue
    }
    if ($ch -eq '"') { $inQuotes = -not $inQuotes; $hasToken = $true; $i++; continue }
    if (($ch -eq ' ' -or $ch -eq "`t") -and -not $inQuotes) {
      if ($hasToken) { $list += $cur.ToString(); $cur = New-Object System.Text.StringBuilder; $hasToken = $false }
      $i++; continue
    }
    [void]$cur.Append($ch); $hasToken = $true; $i++
  }
  if ($hasToken) { $list += $cur.ToString() }
  return , $list
}

function Same([string[]]$a, [string[]]$b) {
  if ($a.Count -ne $b.Count) { return $false }
  for ($i = 0; $i -lt $a.Count; $i++) { if ($a[$i] -ne $b[$i]) { return $false } }
  return $true
}
function Codes([string]$s) { (($s.ToCharArray() | ForEach-Object { [int]$_ }) -join '.') }

$cr = [string][char]13
$lf = [string][char]10
$accept = @(
  @('https://a.com/v.mp4'),
  @('https://a.com/v.mp4', 'name with spaces.mp4'),
  @('trailing\'),
  @('dir\\'),
  @('x&calc.exe'),
  @('x|more'),
  @('$(whoami)'),
  @('a`b'),
  @('--header', 'Referer:https://site/a b'),
  @(''),
  @('中文 文件名.mp4'),
  @('a\b\c d'),
  @('a b\c'),
  @('-headers', ('Referer: https://a/b' + $cr + $lf + 'User-Agent: Mozilla/5.0 (X11; Linux)' + $cr + $lf)),
  @('--input-url', 'https://a.com/v.m3u8', '--save-name', '视频 名字', '--auto-select'),
  @('-hide_banner', '-loglevel', 'error', '-y', '-i', 'https://a.com/v.mp4', '-c', 'copy', 'out.mp4'),
  # yt-dlp 极速下载：进度模板含空格与 $()，输出目录可能含空格（用户名带空格）
  @('--newline', '--no-playlist', '--progress-template', 'download:PROGRESS $(progress._percent_str)', '-P', 'C:\Users\Zhang San\Downloads\MediaPlus', 'https://www.youtube.com/watch?v=abc')
)
$reject = @(
  @('a"b'),
  @('a\"b'),
  @('a b\'),
  @('"'),
  @('ok', 'bad"arg')
)

$fail = 0
foreach ($case in $accept) {
  $line = Build-ArgLine ([string[]]$case)
  if ([string]::IsNullOrEmpty($line)) {
    $fail++; Write-Output ('FAIL empty argline for [' + ($case -join '|') + ']'); continue
  }
  $w = Parse-ArgvW $line
  $c = Parse-Crt $line
  $okW = Same $case $w
  $okC = Same $case $c
  if (-not ($okW -and $okC)) {
    $fail++
    Write-Output ('FAIL input=[' + ($case -join '|') + '] line=' + $line)
    if (-not $okW) { Write-Output ('  argvW -> [' + (($w | ForEach-Object { Codes $_ }) -join ' / ') + ']') }
    if (-not $okC) { Write-Output ('  crt   -> [' + (($c | ForEach-Object { Codes $_ }) -join ' / ') + ']') }
  }
}
foreach ($case in $reject) {
  $threw = $false
  try { Build-ArgLine ([string[]]$case) | Out-Null } catch { $threw = $true }
  if (-not $threw) { $fail++; Write-Output ('FAIL not rejected: [' + ($case -join '|') + ']') }
}

# URL 闸门：host 是 CreateProcess 前最后一道，扩展侧漏检时必须独立拦住
$urlAccept = @(
  'https://cdn.example.com/a.mp4',
  'http://127.0.0.1:8080/a.m3u8',
  'https://www.youtube.com/watch?v=abc&t=1'
)
$urlReject = @(
  '',
  'file:///C:/secret.txt',
  'blob:https://site/uuid',
  'chrome-extension://id/a.mp4',
  'not a url',
  'https://a.com/x.mp4"',
  'https://a.com/x.mp4" --exec "calc.exe',
  "https://a.com/x.mp4`n--evil",
  "https://a.com/x.mp4`t"
)
foreach ($u in $urlAccept) {
  if (-not (Test-SafeRemoteUrl $u)) { $fail++; Write-Output ('FAIL url rejected: ' + $u) }
}
foreach ($u in $urlReject) {
  if (Test-SafeRemoteUrl $u) { $fail++; Write-Output ('FAIL url accepted: ' + $u) }
}

if ($fail -eq 0) {
  Write-Output ('ARGV_OK ' + $accept.Count + ' accept (both oracles) + ' + $reject.Count + ' reject + url ' + $urlAccept.Count + ' accept/' + $urlReject.Count + ' reject')
} else {
  Write-Output ('ARGV_FAILED ' + $fail)
  exit 1
}