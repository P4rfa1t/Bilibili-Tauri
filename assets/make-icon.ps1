Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

$bgPath = New-RoundedRect 0 0 $size $size 220
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($size, $size)),
    [System.Drawing.Color]::FromArgb(255, 251, 114, 153),
    [System.Drawing.Color]::FromArgb(255, 0, 174, 236)
)
$g.FillPath($brush, $bgPath)

# 柔光
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath
$glow.AddEllipse(-180, -260, 900, 900)
$glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($glow)
$glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(70, 255, 255, 255)
$glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
$g.FillPath($glowBrush, $glow)

# 天线
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 30)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($pen, 400, 300, 306, 176)
$g.DrawLine($pen, 624, 300, 718, 176)

# 电视外壳
$body = New-RoundedRect 164 284 696 528 86
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillPath($white, $body)

# 屏幕
$screen = New-RoundedRect 230 350 564 396 42
$dark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 17, 20, 27))
$g.FillPath($dark, $screen)

# 播放三角
$play = New-Object System.Drawing.Drawing2D.GraphicsPath
$play.AddPolygon(@(
    (New-Object System.Drawing.PointF(468, 432)),
    (New-Object System.Drawing.PointF(468, 664)),
    (New-Object System.Drawing.PointF(660, 548))
))
$g.FillPath($white, $play)

# 底部小灯
$g.FillEllipse($white, 742, 766, 22, 22)

$out = Join-Path $PSScriptRoot 'logo.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved $out"
