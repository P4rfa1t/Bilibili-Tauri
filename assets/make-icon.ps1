Add-Type -AssemblyName System.Drawing

# Matches the inline SVG of .brand-mark in src/index.html:
# gradient rounded background + solid white TV with antenna,
# and the play triangle cut out so the gradient shows through.
# No dark screen anymore.

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

# soft highlight
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath
$glow.AddEllipse(-180, -260, 900, 900)
$glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($glow)
$glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(70, 255, 255, 255)
$glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
$g.FillPath($glowBrush, $glow)

# antenna
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 34)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($pen, 404, 300, 300, 168)
$g.DrawLine($pen, 620, 300, 724, 168)

# TV body in pure white
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$body = New-RoundedRect 148 280 728 552 92
$g.FillPath($white, $body)

# play triangle: filled with the same gradient as the background
$tri = New-Object System.Drawing.Drawing2D.GraphicsPath
$pts = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF(444, 424)),
    (New-Object System.Drawing.PointF(444, 690)),
    (New-Object System.Drawing.PointF(672, 557))
)
$tri.AddPolygon($pts)
$g.FillPath($brush, $tri)

$out = Join-Path $PSScriptRoot 'logo.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved $out"
