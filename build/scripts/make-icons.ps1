# 图标生成脚本：indigo 渐变圆角方块 + 白色下载箭头
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File build/scripts/make-icons.ps1
# 依赖：.NET System.Drawing（Windows 自带）
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outDir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-Icon([int]$size, [string]$file) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # 圆角矩形背景（indigo 渐变 #6366f1 -> #4f46e5）
  $r = [int]($size * 0.22)
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
  $gp.AddArc($size - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
  $gp.AddArc($size - 2 * $r, $size - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $gp.AddArc(0, $size - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $gp.CloseFigure()
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $c1 = [System.Drawing.Color]::FromArgb(255, 99, 102, 241)
  $c2 = [System.Drawing.Color]::FromArgb(255, 79, 70, 229)
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 90)
  $g.FillPath($bgBrush, $gp)

  # 白色下载箭头（归一化坐标：竖线 + 三角头 + 底部托盘）
  $penW = [Math]::Max(1.0, $size * 0.085)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [float]$penW)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $x = [float]($size * 0.5)
  $g.DrawLine($pen, $x, ($size * 0.22), $x, ($size * 0.56))
  $headBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $half = $size * 0.185
  $tipY = $size * 0.74
  $topY = $size * 0.52
  $pts = @(
    (New-Object System.Drawing.PointF(($x - $half), $topY)),
    (New-Object System.Drawing.PointF(($x + $half), $topY)),
    (New-Object System.Drawing.PointF($x, $tipY))
  )
  $g.FillPolygon($headBrush, $pts)
  $trayY = $size * 0.82
  $g.DrawLine($pen, ($size * 0.28), $trayY, ($size * 0.72), $trayY)

  $path = Join-Path $outDir $file
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $pen.Dispose(); $headBrush.Dispose(); $bgBrush.Dispose(); $gp.Dispose()
  Write-Host "generated $path ($size px)"
}

New-Icon 128 'icon-128.png'
New-Icon 48 'icon-48.png'
New-Icon 16 'icon-16.png'
Write-Host 'Icons complete.'
