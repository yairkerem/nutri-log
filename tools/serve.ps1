<#
    שרת סטטי מקומי, בלי תלויות חיצוניות.
    הכתבה קולית בדפדפן פועלת רק מ-localhost או מ-https, ולכן כדאי להריץ את היומן כך:

        powershell -ExecutionPolicy Bypass -File tools\serve.ps1

    ואז לפתוח את הכתובת http://localhost:8123 בדפדפן. Ctrl+C עוצר את השרת.
#>
param(
    [int]$Port = 8123,
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.ico'  = 'image/x-icon'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/markdown; charset=utf-8'
}

$rootFull = (Resolve-Path -LiteralPath $Root).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
    $listener.Start()
} catch {
    Write-Host "לא הצלחתי לפתוח את הפורט $Port. אפשר לנסות פורט אחר: -Port 8124" -ForegroundColor Red
    exit 1
}

Write-Host "היומן זמין בכתובת http://localhost:$Port  (Ctrl+C לעצירה)" -ForegroundColor Green
Write-Host "מגיש קבצים מהתיקייה $rootFull"

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestPath = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
    if ($requestPath -eq '/') { $requestPath = '/index.html' }

    $relative = $requestPath.TrimStart('/') -replace '/', [System.IO.Path]::DirectorySeparatorChar
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $rootFull $relative))

    # לא מגישים קבצים שמחוץ לתיקיית הפרויקט.
    $inside = $candidate.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)

    # בקשה אחת שנכשלת לא אמורה להפיל את השרת.
    try {
        if ($inside -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $extension = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
            $contentType = $mime[$extension]
            if (-not $contentType) { $contentType = 'application/octet-stream' }

            $bytes = [System.IO.File]::ReadAllBytes($candidate)
            $context.Response.ContentType = $contentType
            $context.Response.Headers.Add('Cache-Control', 'no-store')
            $context.Response.ContentLength64 = $bytes.Length

            # ל-HEAD מחזירים כותרות בלבד; כתיבת גוף תזרוק חריגה.
            if ($context.Request.HttpMethod -ne 'HEAD') {
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            Write-Host ("200 " + $requestPath)
        } else {
            $context.Response.StatusCode = 404
            Write-Host ("404 " + $requestPath) -ForegroundColor DarkYellow
        }
    } catch {
        Write-Host ("500 " + $requestPath + " - " + $_.Exception.Message) -ForegroundColor Red
        try { $context.Response.StatusCode = 500 } catch { }
    }

    try { $context.Response.Close() } catch { }
}
