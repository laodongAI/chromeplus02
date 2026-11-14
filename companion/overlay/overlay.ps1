# ==========================================================================
# MediaPlus 桌面标注层（Desktop Annotation Overlay）
# --------------------------------------------------------------------------
# 作用：在「整个桌面」之上叠加一层透明画布，可以直接在 PPT / 视频 / 任意
#       应用窗口上画重点、写字、擦除；配合 Chrome 的「整屏录制」，笔迹会
#       被一起录入视频。适用于讲课、演示、录屏讲解场景。
#
# 原理：WinForms + 分层窗口（UpdateLayeredWindow）实现逐像素透明；
#       背景 alpha=1（肉眼不可见）保证绘制模式下能接收鼠标；
#       操作模式下追加 WS_EX_TRANSPARENT，让点击穿透到下层应用。
#
# 快捷键（全局，任何应用在前台时都生效）：
#   Ctrl+Alt+D  切换 绘制 / 操作（操作模式 = 点击穿透，可正常使用电脑）
#   Ctrl+Alt+T  显示 / 隐藏 工具栏（录屏时可隐藏，画面更干净）
#   Ctrl+Alt+Z  撤销上一笔
#   Ctrl+Alt+X  清空全部笔迹
#   Ctrl+Alt+Q  退出桌面标注
#   空格        绘制模式下切换 绘制 / 操作（窗口有焦点时）
#
# 工具：画笔 / 荧光笔 / 橡皮擦 / 文字 / 矩形 / 直线 / 箭头
#       5 种颜色、粗细 1-12、白板/黑板背景
#
# 退出码：0 正常退出；1 启动失败（如已在运行）
# ==========================================================================

# 严格错误处理：任何未捕获错误都终止脚本，避免静默失败
$ErrorActionPreference = 'Stop'

# 加载 WinForms / GDI+ 组件（后续互斥量提示框也依赖它）
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 只允许单实例：用互斥量判断是否已经有一个标注层在运行
$script:mutexName = 'Global\MediaPlusDesktopAnnotate'
$script:mutexCreated = $false
$script:mutex = [System.Threading.Mutex]::new($true, $script:mutexName, [ref]$script:mutexCreated)
if (-not $script:mutexCreated) {
  [void][System.Windows.Forms.MessageBox]::Show('桌面标注已经在运行。可先按 Ctrl+Alt+Q 退出后再启动。', 'MediaPlus 桌面标注')
  exit 1
}

# ── 原生 API 与消息过滤器（C# 内联编译） ────────────────────────────────
Add-Type -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing') -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class Ovl
{
    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_LAYERED = 0x00080000;
    public const int WS_EX_TRANSPARENT = 0x00000020;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int ULW_ALPHA = 2;

    /// <summary>最近一次 UpdateLayeredWindow 是否成功（供冒烟测试/日志使用）</summary>
    public static bool LastUpdateOk = false;

    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx, cy; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }

    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst,
        ref SIZE psize, IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);
    [DllImport("user32.dll", EntryPoint = "GetWindowLong")] static extern int GetWindowLong32(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")] static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", EntryPoint = "SetWindowLong")] static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")] static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

    /// <summary>读取扩展窗口样式（32/64 位自适应）</summary>
    public static int GetExStyle(IntPtr hWnd)
    {
        return IntPtr.Size == 8
            ? (int)(long)GetWindowLongPtr64(hWnd, GWL_EXSTYLE)
            : GetWindowLong32(hWnd, GWL_EXSTYLE);
    }

    /// <summary>设置扩展窗口样式（32/64 位自适应）</summary>
    public static void SetExStyle(IntPtr hWnd, int style)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hWnd, GWL_EXSTYLE, (IntPtr)style);
        else SetWindowLong32(hWnd, GWL_EXSTYLE, style);
    }

    /// <summary>
    /// 把源位图的 HDC 提交到分层窗口（逐像素 alpha 合成）。
    /// 在 C# 内部构造 POINT/SIZE/BLENDFUNCTION，避免 PowerShell 对嵌套结构体字段赋值丢失。
    /// </summary>
    public static bool UpdateLayer(IntPtr hwnd, IntPtr hdcDst, int x, int y, int w, int h, IntPtr hdcSrc)
    {
        POINT ptDst = new POINT(); ptDst.x = x; ptDst.y = y;      // 目标窗口左上角（虚拟屏幕坐标）
        SIZE sz = new SIZE(); sz.cx = w; sz.cy = h;               // 窗口尺寸
        POINT ptSrc = new POINT();                                 // 源位图起点 (0,0)
        BLENDFUNCTION bf = new BLENDFUNCTION();
        bf.BlendOp = 0;                 // AC_SRC_OVER：按源 alpha 混合
        bf.BlendFlags = 0;
        bf.SourceConstantAlpha = 255;   // 不做整体透明度衰减
        bf.AlphaFormat = 1;             // AC_SRC_ALPHA：使用源像素 alpha
        LastUpdateOk = UpdateLayeredWindow(hwnd, hdcDst, ref ptDst, ref sz, hdcSrc, ref ptSrc, 0, ref bf, ULW_ALPHA);
        return LastUpdateOk;
    }
}

/// <summary>全局热键过滤器：拦截 WM_HOTKEY 并转成事件</summary>
public class HotkeyFilter : IMessageFilter
{
    public event Action<int> Hotkey;
    public bool PreFilterMessage(ref Message m)
    {
        if (m.Msg == 0x0312)
        {
            if (Hotkey != null) Hotkey(m.WParam.ToInt32());
            return true;
        }
        return false;
    }
}
'@

# DPI 感知：避免多显示器 / 缩放环境下坐标与像素错位
[void][Ovl]::SetProcessDPIAware()

# ── 全局状态 ────────────────────────────────────────────────────────────
$script:shapes = New-Object System.Collections.ArrayList   # 已完成的笔迹列表
$script:current = $null                                    # 正在绘制的笔迹
$script:tool = 'pen'                                       # 当前工具
$script:color = [System.Drawing.ColorTranslator]::FromHtml('#ef4444')  # 当前颜色
$script:lineWidth = 4                                      # 当前粗细（1-12）
$script:bgMode = 'none'                                    # 背景：none / white / black
$script:operateMode = $false                               # 是否操作模式（点击穿透）
$script:toolbarVisible = $true                             # 工具栏是否可见
$script:toolbarItems = @()                                 # 工具栏可点击区域（每帧重算）
$script:tbarTop = 10                                       # 工具栏顶部 y 坐标
$script:tbarH = 28                                         # 按钮高度

# 虚拟屏幕（覆盖所有显示器；多屏时原点可能为负）
$script:vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$script:screenW = $script:vs.Width
$script:screenH = $script:vs.Height

# ── 分层窗口画布初始化 ──────────────────────────────────────────────────
# 屏幕 DC：仅作为 UpdateLayeredWindow 的参考目标 DC
$script:hdcScreen = [Ovl]::GetDC([IntPtr]::Zero)
# 画布位图：32 位 ARGB，GDI+ 绘制会正确写入 alpha 通道（透明背景 / 半透明荧光笔依赖它）
try {
  $script:bmp = [System.Drawing.Bitmap]::new(
    $script:screenW, $script:screenH,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $script:g = [System.Drawing.Graphics]::FromImage($script:bmp)
} catch {
  # 位图创建失败通常是分辨率过大导致内存不足，明确提示而不是静默失败
  throw "创建标注画布失败（$($script:screenW)x$($script:screenH)）：$($_.Exception.Message)"
}
$script:g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$script:g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# 常用字体缓存（避免每帧重复创建字体对象）
$script:fontUi = [System.Drawing.Font]::new('Microsoft YaHei', 9)
$script:fontSmall = [System.Drawing.Font]::new('Microsoft YaHei', 8)

# ── 绘制：单个笔迹 ──────────────────────────────────────────────────────
<#
.SYNOPSIS
    把一个笔迹元素绘制到画布。
.DESCRIPTION
    支持画笔/荧光笔/橡皮擦/矩形/直线/箭头/文字；橡皮擦在透明背景下用
    SourceCopy 抹成透明，在白/黑背景下用背景色覆盖。
.PARAMETER s
    笔迹对象：@{ Tool; Color; Width; Points; Text }
#>
function Draw-Shape($s) {
  $c = $s.Color
  $w = [double]$s.Width

  # 荧光笔：半透明 + 加粗
  if ($s.Tool -eq 'highlighter') {
    $c = [System.Drawing.Color]::FromArgb(90, $c.R, $c.G, $c.B)
    $w = $w * 2.5
  }
  # 橡皮擦：宽度放大一倍，擦除更顺手
  if ($s.Tool -eq 'eraser') { $w = $w * 2 }

  # 文字单独处理：字号由粗细推算，保证与浏览器覆盖层观感一致
  if ($s.Tool -eq 'text') {
    $size = [Math]::Max(16, $s.Width * 5 + 10)
    $font = [System.Drawing.Font]::new('Microsoft YaHei', $size, [System.Drawing.FontStyle]::Bold)
    $brush = [System.Drawing.SolidBrush]::new($c)
    $script:g.DrawString($s.Text, $font, $brush, [float]$s.Points[0].X, [float]$s.Points[0].Y)
    $brush.Dispose(); $font.Dispose()
    return
  }

  # 构造画笔：橡皮擦在透明背景使用 SourceCopy + 全透明色
  $erase = $false
  if ($s.Tool -eq 'eraser') {
    if ($script:bgMode -eq 'none') {
      $script:g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(0, 0, 0, 0), [float]$w)
      $erase = $true
    } else {
      $bgColor = if ($script:bgMode -eq 'white') { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(17, 17, 17) }
      $pen = [System.Drawing.Pen]::new($bgColor, [float]$w)
    }
  } else {
    $pen = [System.Drawing.Pen]::new($c, [float]$w)
  }
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $pts = $s.Points
  if ($pts.Count -ge 2) {
    $a = $pts[0]
    $b = $pts[$pts.Count - 1]
    switch ($s.Tool) {
      'rect' {
        $script:g.DrawRectangle($pen, [float]$a.X, [float]$a.Y, [float]($b.X - $a.X), [float]($b.Y - $a.Y))
      }
      'line' {
        $script:g.DrawLine($pen, [float]$a.X, [float]$a.Y, [float]$b.X, [float]$b.Y)
      }
      'arrow' {
        $script:g.DrawLine($pen, [float]$a.X, [float]$a.Y, [float]$b.X, [float]$b.Y)
        # 箭头头部三角
        $ang = [Math]::Atan2([double]($b.Y - $a.Y), [double]($b.X - $a.X))
        $head = [Math]::Max(12, [double]$s.Width * 3.5)
        $tri = @(
          [System.Drawing.PointF]::new([float]$b.X, [float]$b.Y),
          [System.Drawing.PointF]::new([float]($b.X - $head * [Math]::Cos($ang - [Math]::PI / 6)), [float]($b.Y - $head * [Math]::Sin($ang - [Math]::PI / 6))),
          [System.Drawing.PointF]::new([float]($b.X - $head * [Math]::Cos($ang + [Math]::PI / 6)), [float]($b.Y - $head * [Math]::Sin($ang + [Math]::PI / 6)))
        )
        $brush = [System.Drawing.SolidBrush]::new($c)
        $script:g.FillPolygon($brush, [System.Drawing.PointF[]]$tri)
        $brush.Dispose()
      }
      default {
        # 画笔 / 荧光笔 / 橡皮擦：逐段连线
        for ($i = 1; $i -lt $pts.Count; $i++) {
          $script:g.DrawLine($pen, [float]$pts[$i - 1].X, [float]$pts[$i - 1].Y, [float]$pts[$i].X, [float]$pts[$i].Y)
        }
      }
    }
  }

  $pen.Dispose()
  # 橡皮擦绘制完成后恢复默认合成模式，避免影响后续笔迹
  if ($erase) { $script:g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver }
}

# ── 工具栏布局 ──────────────────────────────────────────────────────────
<#
.SYNOPSIS
    计算工具栏按钮布局。
.DESCRIPTION
    返回按钮数组，每项包含 Rect（点击区域）、Kind（类型）、Value（取值）、
    Label（文案）、Active（是否高亮）。每帧重算，保证状态实时。
#>
function Get-ToolbarItems {
  $items = @()
  $x = 16
  $y = $script:tbarTop
  $h = $script:tbarH

  # 工具按钮（7 个）
  $tools = @(
    @{ Key = 'pen'; Label = '画笔' },
    @{ Key = 'highlighter'; Label = '荧光' },
    @{ Key = 'eraser'; Label = '橡皮' },
    @{ Key = 'text'; Label = '文字' },
    @{ Key = 'rect'; Label = '矩形' },
    @{ Key = 'line'; Label = '直线' },
    @{ Key = 'arrow'; Label = '箭头' }
  )
  foreach ($t in $tools) {
    $items += [pscustomobject]@{
      Kind = 'tool'; Value = $t.Key; Label = $t.Label
      Rect = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]46, [float]$h)
      Active = ($script:tool -eq $t.Key); Color = $null
    }
    $x += 52
  }
  $x += 4

  # 颜色圆点（5 个）
  foreach ($hex in @('#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff')) {
    $active = ($script:color.ToArgb() -eq [System.Drawing.ColorTranslator]::FromHtml($hex).ToArgb())
    $items += [pscustomobject]@{
      Kind = 'color'; Value = $hex; Label = ''
      Rect = [System.Drawing.RectangleF]::new([float]$x, [float]($y + 4), [float]20, [float]20)
      Active = $active; Color = $hex
    }
    $x += 26
  }
  $x += 4

  # 粗细 - / +
  $items += [pscustomobject]@{ Kind = 'width-'; Value = '-'; Label = '细'; Rect = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]30, [float]$h); Active = $false; Color = $null }
  $x += 34
  $items += [pscustomobject]@{ Kind = 'width+'; Value = '+'; Label = '粗'; Rect = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]30, [float]$h); Active = $false; Color = $null }
  $x += 40

  # 背景切换
  $bgLabel = if ($script:bgMode -eq 'none') { '背景:无' } elseif ($script:bgMode -eq 'white') { '背景:白' } else { '背景:黑' }
  $items += [pscustomobject]@{ Kind = 'bg'; Value = ''; Label = $bgLabel; Rect = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]72, [float]$h); Active = ($script:bgMode -ne 'none'); Color = $null }
  $x += 78

  # 操作模式（点击穿透）
  $items += [pscustomobject]@{ Kind = 'mode'; Value = ''; Label = '操作'; Rect = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]52, [float]$h); Active = $script:operateMode; Color = $null }
  $x += 58

  # 撤销 / 清空 / 退出
  $items += [pscustomobject]@{ Kind = 'undo'; Value = ''; Label = '撤销'; Rect = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]52, [float]$h); Active = $false; Color = $null }
  $x += 58
  $items += [pscustomobject]@{ Kind = 'clear'; Value = ''; Label = '清空'; Rect = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]52, [float]$h); Active = $false; Color = $null }
  $x += 58
  $items += [pscustomobject]@{ Kind = 'exit'; Value = ''; Label = '退出'; Rect = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]52, [float]$h); Active = $false; Color = $null }

  return $items
}

<#
.SYNOPSIS
    绘制工具栏。
.DESCRIPTION
    工具栏为自绘，隐藏时完全不渲染，因此不会出现在录屏画面中。
#>
function Draw-Toolbar {
  if (-not $script:toolbarVisible) { $script:toolbarItems = @(); return }

  $items = Get-ToolbarItems
  $script:toolbarItems = $items

  # 计算工具栏整体尺寸（最后一个按钮的右边界）
  $maxRight = 0
  foreach ($it in $items) { if ($it.Rect.Right -gt $maxRight) { $maxRight = $it.Rect.Right } }
  $barRect = [System.Drawing.RectangleF]::new([float]10, [float]($script:tbarTop - 6), [float]($maxRight - 4), [float]($script:tbarH + 12))

  # 背板 + 边框
  $barBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(235, 20, 22, 29))
  $script:g.FillRectangle($barBrush, $barRect)
  $barBrush.Dispose()
  $barPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(120, 255, 255, 255), 1)
  $script:g.DrawRectangle($barPen, $barRect.X, $barRect.Y, $barRect.Width, $barRect.Height)
  $barPen.Dispose()

  # 逐个绘制按钮
  foreach ($it in $items) {
    $r = $it.Rect
    if ($it.Kind -eq 'color') {
      # 颜色圆点（选中时外圈高亮）
      $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($it.Value))
      $script:g.FillEllipse($brush, $r)
      $brush.Dispose()
      if ($it.Active) {
        $ring = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 2)
        $script:g.DrawEllipse($ring, $r.X - 2, $r.Y - 2, $r.Width + 4, $r.Height + 4)
        $ring.Dispose()
      }
      continue
    }
    # 普通按钮
    $bg = if ($it.Active) { [System.Drawing.Color]::FromArgb(99, 102, 241) } else { [System.Drawing.Color]::FromArgb(56, 60, 74) }
    $brush = [System.Drawing.SolidBrush]::new($bg)
    $script:g.FillRectangle($brush, $r)
    $brush.Dispose()
    $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(235, 255, 255, 255))
    $size = $script:g.MeasureString($it.Label, $script:fontUi)
    $tx = $r.X + ($r.Width - $size.Width) / 2
    $ty = $r.Y + ($r.Height - $size.Height) / 2
    $script:g.DrawString($it.Label, $script:fontUi, $textBrush, [float]$tx, [float]$ty)
    $textBrush.Dispose()
  }
}

# ── 画布刷新 ────────────────────────────────────────────────────────────
<#
.SYNOPSIS
    把内存位图提交到分层窗口。
.DESCRIPTION
    调用 UpdateLayeredWindow 完成逐像素透明合成；每次重绘后都必须调用。
#>
function Update-Surface {
  # 取位图 HDC：Bitmap(Format32bppArgb) 的像素缓冲带 alpha，可直接交给 UpdateLayeredWindow
  $hdcSrc = $script:g.GetHdc()
  try {
    [void][Ovl]::UpdateLayer(
      $script:form.Handle, $script:hdcScreen,
      $script:form.Left, $script:form.Top,
      $script:form.Width, $script:form.Height,
      $hdcSrc
    )
  } finally {
    # 必须在绘制前释放 HDC，否则后续 GDI+ 绘制行为未定义
    $script:g.ReleaseHdc($hdcSrc)
  }
}

<#
.SYNOPSIS
    重绘整块画布并提交。
.DESCRIPTION
    先按背景模式铺底（白/黑会遮住桌面，形成白板/黑板），
    再回放全部笔迹与正在绘制的笔迹，最后画工具栏并提交。
#>
function Draw-All {
  # 背景 alpha=1：肉眼不可见，但保证绘制模式下整屏可点击
  $script:g.Clear([System.Drawing.Color]::FromArgb(1, 0, 0, 0))
  if ($script:bgMode -eq 'white') { $script:g.Clear([System.Drawing.Color]::White) }
  elseif ($script:bgMode -eq 'black') { $script:g.Clear([System.Drawing.Color]::FromArgb(17, 17, 17)) }

  foreach ($s in $script:shapes) { Draw-Shape $s }
  if ($null -ne $script:current) { Draw-Shape $script:current }

  Draw-Toolbar
  $script:g.Flush()
  Update-Surface
}

<#
.SYNOPSIS
    应用操作/绘制模式（切换窗口点击穿透属性）。
.PARAMETER operate
    true = 操作模式（点击穿透）；false = 绘制模式（接管鼠标）
#>
function Apply-Mode([bool]$operate) {
  $script:operateMode = $operate
  $hwnd = $script:form.Handle
  $style = [Ovl]::GetExStyle($hwnd)
  if ($operate) {
    $style = $style -bor [Ovl]::WS_EX_TRANSPARENT
  } else {
    $style = $style -band (-bnot [Ovl]::WS_EX_TRANSPARENT)
  }
  [Ovl]::SetExStyle($hwnd, $style)
  $script:form.Cursor = if ($operate) { [System.Windows.Forms.Cursors]::Default } else { [System.Windows.Forms.Cursors]::Cross }
  Draw-All
}

<#
.SYNOPSIS
    显示/隐藏工具栏。
#>
function Toggle-Toolbar {
  $script:toolbarVisible = -not $script:toolbarVisible
  Draw-All
}

<#
.SYNOPSIS
    执行工具栏按钮动作。
.PARAMETER item
    Get-ToolbarItems 返回的按钮对象
#>
function Invoke-ToolbarItem($item) {
  switch ($item.Kind) {
    'tool' {
      $script:tool = $item.Value
      Apply-Mode $false          # 选工具时自动回到绘制模式
    }
    'color' {
      $script:color = [System.Drawing.ColorTranslator]::FromHtml($item.Value)
      Draw-All
    }
    'width-' {
      $script:lineWidth = [Math]::Max(1, $script:lineWidth - 1)
      Draw-All
    }
    'width+' {
      $script:lineWidth = [Math]::Min(12, $script:lineWidth + 1)
      Draw-All
    }
    'bg' {
      if ($script:bgMode -eq 'none') { $script:bgMode = 'white' }
      elseif ($script:bgMode -eq 'white') { $script:bgMode = 'black' }
      else { $script:bgMode = 'none' }
      Draw-All
    }
    'mode' {
      Apply-Mode (-not $script:operateMode)
    }
    'undo' {
      if ($script:shapes.Count -gt 0) { $script:shapes.RemoveAt($script:shapes.Count - 1); Draw-All }
    }
    'clear' {
      $script:shapes.Clear(); Draw-All
    }
    'exit' {
      $script:form.Close()
    }
  }
}

<#
.SYNOPSIS
    弹出文字输入框并把文字写入画布。
.PARAMETER x
    文字落点屏幕坐标 x
.PARAMETER y
    文字落点屏幕坐标 y
#>
function Show-TextInput([double]$x, [double]$y) {
  $dlg = New-Object System.Windows.Forms.Form
  $dlg.Text = '输入文字（回车确认，Esc 取消）'
  $dlg.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
  $dlg.TopMost = $true
  $dlg.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $dlg.Location = [System.Drawing.Point]::new([int]$x, [int]$y)
  $dlg.Size = [System.Drawing.Size]::new(380, 96)

  $tb = New-Object System.Windows.Forms.TextBox
  $tb.Location = [System.Drawing.Point]::new(12, 16)
  $tb.Width = 340
  $tb.Font = [System.Drawing.Font]::new('Microsoft YaHei', 12)
  $dlg.Controls.Add($tb)

  # 回车确认 / Esc 取消（GetNewClosure 让回调捕获局部控件变量）
  $tb.Add_KeyDown({
    if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
      $dlg.DialogResult = [System.Windows.Forms.DialogResult]::OK
      $dlg.Close()
    } elseif ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
      $dlg.Close()
    }
  }.GetNewClosure())

  $result = $dlg.ShowDialog()
  $text = $tb.Text.Trim()
  $dlg.Dispose()

  if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $text) {
    # 屏幕坐标 → 窗口客户区坐标
    $px = $x - $script:form.Left
    $py = $y - $script:form.Top
    $shape = [pscustomobject]@{
      Tool = 'text'; Color = $script:color; Width = $script:lineWidth
      Points = @([System.Drawing.PointF]::new([float]$px, [float]$py)); Text = $text
    }
    [void]$script:shapes.Add($shape)
    Draw-All
  }
  $script:form.Activate()
}

# ── 鼠标交互 ────────────────────────────────────────────────────────────
<#
.SYNOPSIS
    工具栏点击命中判断与分发。
.PARAMETER x
    客户区 x
.PARAMETER y
    客户区 y
.RETURNS
    true = 已消费（点击落在工具栏上，不绘制）
#>
function Test-ToolbarClick([double]$x, [double]$y) {
  if (-not $script:toolbarVisible) { return $false }
  foreach ($it in $script:toolbarItems) {
    if ($it.Rect.Contains([float]$x, [float]$y)) {
      Invoke-ToolbarItem $it
      return $true
    }
  }
  # 落在工具栏背板范围内也不绘制，避免误画
  if ($y -lt ($script:tbarTop + $script:tbarH + 8)) { return $true }
  return $false
}

<#
.SYNOPSIS
    鼠标按下：优先处理工具栏点击，其次开始笔画或弹文字输入。
#>
function On-MouseDown($e) {
  if ($e.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
  if (Test-ToolbarClick $e.X $e.Y) { return }
  if ($script:tool -eq 'text') {
    Show-TextInput ($script:form.Left + $e.X) ($script:form.Top + $e.Y)
    return
  }
  $script:current = [pscustomobject]@{
    Tool = $script:tool; Color = $script:color; Width = $script:lineWidth
    Points = @([System.Drawing.PointF]::new([float]$e.X, [float]$e.Y)); Text = ''
  }
  Draw-All
}

<#
.SYNOPSIS
    鼠标移动：追加轨迹点并实时重绘。
#>
function On-MouseMove($e) {
  if ($null -eq $script:current) { return }
  $pts = $script:current.Points
  $last = $pts[$pts.Count - 1]
  # 距离小于 1px 的点忽略，减少无意义的重复绘制
  if ([Math]::Abs($e.X - $last.X) -lt 1 -and [Math]::Abs($e.Y - $last.Y) -lt 1) { return }
  $script:current.Points += [System.Drawing.PointF]::new([float]$e.X, [float]$e.Y)
  Draw-All
}

<#
.SYNOPSIS
    鼠标抬起：把当前笔画归档。
#>
function On-MouseUp($e) {
  if ($null -eq $script:current) { return }
  if ($script:current.Points.Count -gt 1) {
    [void]$script:shapes.Add($script:current)
  }
  $script:current = $null
  Draw-All
}

# ── 热键处理 ────────────────────────────────────────────────────────────
<#
.SYNOPSIS
    处理全局热键回调。
.PARAMETER id
    热键编号：1 切模式 / 2 切工具栏 / 3 撤销 / 4 清空 / 5 退出
#>
function Handle-Hotkey([int]$id) {
  switch ($id) {
    1 { Apply-Mode (-not $script:operateMode) }
    2 { Toggle-Toolbar }
    3 { if ($script:shapes.Count -gt 0) { $script:shapes.RemoveAt($script:shapes.Count - 1); Draw-All } }
    4 { $script:shapes.Clear(); Draw-All }
    5 { $script:form.Close() }
  }
}

# ── 创建主窗口 ──────────────────────────────────────────────────────────
$script:form = New-Object System.Windows.Forms.Form
$script:form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$script:form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$script:form.Bounds = $script:vs
$script:form.TopMost = $true
$script:form.ShowInTaskbar = $false
$script:form.BackColor = [System.Drawing.Color]::Black
$script:form.KeyPreview = $true
$script:form.Cursor = [System.Windows.Forms.Cursors]::Cross

# ── 事件绑定 ────────────────────────────────────────────────────────────
# 鼠标按下 / 移动 / 抬起：所有绘制交互都在这里分发
$script:form.Add_MouseDown({ param($sender, $e) On-MouseDown $e })
$script:form.Add_MouseMove({ param($sender, $e) On-MouseMove $e })
$script:form.Add_MouseUp({ param($sender, $e) On-MouseUp $e })

# 空格键：绘制模式下切换「绘制 / 操作」
$script:form.Add_KeyDown({
  param($sender, $e)
  if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Space) {
    Apply-Mode (-not $script:operateMode)
    $e.SuppressKeyPress = $true
  } elseif ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $script:form.Close()
  }
})

# 关闭窗口时注销热键、移除消息过滤器并结束消息循环
$script:form.Add_FormClosing({
  param($sender, $e)
  foreach ($id in 1..5) { [void][Ovl]::UnregisterHotKey($script:form.Handle, $id) }
  [System.Windows.Forms.Application]::RemoveMessageFilter($script:hotkeyFilter)
  [System.Windows.Forms.Application]::ExitThread()
})

# ── 启动窗口 ────────────────────────────────────────────────────────────
# 先强制创建句柄（Handle 会触发原生窗口创建），设置分层样式后再隐藏状态绘制，避免黑底闪烁
$hwnd = $script:form.Handle
$exStyle = [Ovl]::GetExStyle($hwnd)
[Ovl]::SetExStyle($hwnd, ($exStyle -bor [Ovl]::WS_EX_LAYERED -bor [Ovl]::WS_EX_TOOLWINDOW))

# 注册全局热键（Ctrl+Alt 组合，避免占用普通按键）
$modCtrlAlt = 3   # MOD_ALT(1) | MOD_CONTROL(2)
$hotkeys = @(
  @{ Id = 1; Vk = 0x44 },  # D：切换 绘制/操作
  @{ Id = 2; Vk = 0x54 },  # T：切换工具栏
  @{ Id = 3; Vk = 0x5A },  # Z：撤销
  @{ Id = 4; Vk = 0x58 },  # X：清空
  @{ Id = 5; Vk = 0x51 }   # Q：退出
)
$hotkeyFailures = @()
foreach ($hk in $hotkeys) {
  if (-not [Ovl]::RegisterHotKey($hwnd, $hk.Id, $modCtrlAlt, $hk.Vk)) { $hotkeyFailures += $hk.Id }
}
if ($hotkeyFailures.Count -gt 0) {
  [void][System.Windows.Forms.MessageBox]::Show(
    "有 $($hotkeyFailures.Count) 个全局热键注册失败（可能被其他软件占用）。`n可用工具栏按钮操作，或关闭占用 Ctrl+Alt 热键的程序后重试。",
    'MediaPlus 桌面标注'
  )
}

# 热键消息过滤器：把 WM_HOTKEY 转给 Handle-Hotkey
$script:hotkeyFilter = New-Object HotkeyFilter
$script:hotkeyFilter.add_Hotkey({ param($id) Handle-Hotkey $id })
[System.Windows.Forms.Application]::AddMessageFilter($script:hotkeyFilter)

# 首次绘制（此时窗口仍隐藏，直接提交分层表面，避免启动瞬间的黑底闪烁）
Draw-All
# 显示窗口并获取焦点（便于空格快捷键）
$script:form.Show()
[void]$script:form.Activate()

# 进入消息循环，直到窗口关闭
[System.Windows.Forms.Application]::Run()

# ── 清理 ────────────────────────────────────────────────────────────────
$script:g.Dispose()
$script:bmp.Dispose()
[void][Ovl]::ReleaseDC([IntPtr]::Zero, $script:hdcScreen)
$script:mutex.Dispose()
exit 0
