<#
.SYNOPSIS
Fabrique les icônes, l'image de démarrage et le logo des deux applications Expo à partir du logo officiel sur fond blanc.

.DESCRIPTION
Entrée : une image du logo complet (symbole + « neomoov » + signature) sur fond blanc, JPG ou PNG.
Le script détecte le cadre du logo, isole le symbole (première colonne blanche après le symbole), puis écrit dans
apps/mobile-client/assets/images et apps/mobile-driver/assets/images :
  icon.png (1024, symbole), android-icon-foreground.png (1024, symbole dans la zone sûre), android-icon-monochrome.png
  (1024, masque alpha), splash-icon.png (logo complet, 1200 de large), favicon.png (64), logo.png (logo complet, 1000 de large).
Aucune dépendance : System.Drawing (.NET Framework) et un petit assistant C# compilé à la volée.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File infra/scripts/make-app-icons.ps1 -Source "C:\...\identite\logo-fond-blanc.jpg"
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$Repo = ''
)

$ErrorActionPreference = 'Stop'
# $PSScriptRoot n'est pas encore défini quand les valeurs par défaut des paramètres sont évaluées (Windows PowerShell 5.1).
if (-not $Repo) { $Repo = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\..')).Path }
Add-Type -AssemblyName System.Drawing

$cs = @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class NeomoovIcons
{
    static byte[] Pixels(Bitmap bmp, out int stride)
    {
        Rectangle rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        stride = data.Stride;
        byte[] px = new byte[stride * bmp.Height];
        Marshal.Copy(data.Scan0, px, 0, px.Length);
        bmp.UnlockBits(data);
        return px;
    }

    // Cadre des pixels non blancs dans la zone donnée : [gauche, haut, droite, bas].
    public static int[] BoundingBox(Bitmap bmp, int x0, int y0, int x1, int y1, int threshold)
    {
        int stride; byte[] px = Pixels(bmp, out stride);
        int left = x1, top = y1, right = -1, bottom = -1;
        for (int y = y0; y <= y1; y++)
            for (int x = x0; x <= x1; x++)
            {
                int i = y * stride + x * 4;
                if (px[i] < threshold || px[i + 1] < threshold || px[i + 2] < threshold)
                {
                    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
                }
            }
        return new int[] { left, top, right, bottom };
    }

    // Première colonne entièrement blanche après du contenu, en partant de x0 (fin du symbole).
    public static int FirstWhiteColumnAfterContent(Bitmap bmp, int x0, int x1, int y0, int y1, int threshold)
    {
        int stride; byte[] px = Pixels(bmp, out stride);
        bool seen = false;
        for (int x = x0; x <= x1; x++)
        {
            bool white = true;
            for (int y = y0; y <= y1; y++)
            {
                int i = y * stride + x * 4;
                if (px[i] < threshold || px[i + 1] < threshold || px[i + 2] < threshold) { white = false; break; }
            }
            if (!white) seen = true;
            else if (seen) return x;
        }
        return x1;
    }

    public static Bitmap Compose(Bitmap src, Rectangle crop, int width, int height, double fill, bool transparent)
    {
        Bitmap outBmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(outBmp))
        {
            g.Clear(transparent ? Color.Transparent : Color.White);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            double scale = Math.Min(width * fill / crop.Width, height * fill / crop.Height);
            int w = (int)Math.Round(crop.Width * scale), h = (int)Math.Round(crop.Height * scale);
            g.DrawImage(src, new Rectangle((width - w) / 2, (height - h) / 2, w, h), crop, GraphicsUnit.Pixel);
        }
        return outBmp;
    }

    // Masque monochrome Android : l'alpha vient de la densité du pixel (blanc = transparent), la couleur est noire.
    public static void ToMonochrome(Bitmap bmp)
    {
        Rectangle rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int stride = data.Stride; byte[] px = new byte[stride * bmp.Height];
        Marshal.Copy(data.Scan0, px, 0, px.Length);
        for (int y = 0; y < bmp.Height; y++)
            for (int x = 0; x < bmp.Width; x++)
            {
                int i = y * stride + x * 4;
                int min = Math.Min(px[i], Math.Min(px[i + 1], px[i + 2]));
                int alpha = 255 - min;
                if (alpha < 16) alpha = 0;
                px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = (byte)alpha;
            }
        Marshal.Copy(px, 0, data.Scan0, px.Length);
        bmp.UnlockBits(data);
    }
}
"@
Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing

$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source).Path)
$threshold = 235
$all = [NeomoovIcons]::BoundingBox($src, 0, 0, $src.Width - 1, $src.Height - 1, $threshold)
$symbolEnd = [NeomoovIcons]::FirstWhiteColumnAfterContent($src, $all[0], $all[2], $all[1], $all[3], $threshold)
$sym = [NeomoovIcons]::BoundingBox($src, $all[0], $all[1], $symbolEnd, $all[3], $threshold)
$fullCrop = New-Object System.Drawing.Rectangle($all[0], $all[1], ($all[2] - $all[0] + 1), ($all[3] - $all[1] + 1))
$symCrop = New-Object System.Drawing.Rectangle($sym[0], $sym[1], ($sym[2] - $sym[0] + 1), ($sym[3] - $sym[1] + 1))
Write-Host ("Logo complet : {0}x{1} a ({2},{3}) ; symbole : {4}x{5} a ({6},{7})" -f $fullCrop.Width, $fullCrop.Height, $fullCrop.X, $fullCrop.Y, $symCrop.Width, $symCrop.Height, $symCrop.X, $symCrop.Y)

function Save([System.Drawing.Bitmap]$bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("  " + $path)
}

$fullRatio = $fullCrop.Height / $fullCrop.Width
foreach ($app in @('mobile-client', 'mobile-driver')) {
  $dir = Join-Path $Repo ("apps\" + $app + "\assets\images")
  New-Item -ItemType Directory -Force $dir | Out-Null
  Save ([NeomoovIcons]::Compose($src, $symCrop, 1024, 1024, 0.72, $false)) (Join-Path $dir 'icon.png')
  Save ([NeomoovIcons]::Compose($src, $symCrop, 1024, 1024, 0.55, $false)) (Join-Path $dir 'android-icon-foreground.png')
  $mono = [NeomoovIcons]::Compose($src, $symCrop, 1024, 1024, 0.55, $false)
  [NeomoovIcons]::ToMonochrome($mono)
  Save $mono (Join-Path $dir 'android-icon-monochrome.png')
  Save ([NeomoovIcons]::Compose($src, $symCrop, 64, 64, 0.9, $false)) (Join-Path $dir 'favicon.png')
  Save ([NeomoovIcons]::Compose($src, $fullCrop, 1200, [int][Math]::Ceiling(1200 * $fullRatio) + 40, 0.96, $false)) (Join-Path $dir 'splash-icon.png')
  Save ([NeomoovIcons]::Compose($src, $fullCrop, 1000, [int][Math]::Ceiling(1000 * $fullRatio) + 20, 0.98, $false)) (Join-Path $dir 'logo.png')
}
$src.Dispose()
Write-Host 'Termine.'
