param([int]$Port = 8000)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Listener = New-Object System.Net.HttpListener
$Prefix = "http://localhost:$Port/"
$Listener.Prefixes.Add($Prefix)

function Get-ContentType($path) {
  switch ([System.IO.Path]::GetExtension($path).ToLower()) {
    '.html' { 'text/html' }
    '.css'  { 'text/css' }
    '.js'   { 'application/javascript' }
    '.json' { 'application/json' }
    '.png'  { 'image/png' }
    '.jpg'  { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    default { 'application/octet-stream' }
  }
}

try {
  $Listener.Start()
  Start-Process $Prefix
  Write-Host "Server running at $Prefix"
} catch {
  Write-Host "FAILED TO START:"
  Write-Host $_
  pause
  exit
}

while ($Listener.IsListening) {
  $Context = $Listener.GetContext()
  $Path = [System.Uri]::UnescapeDataString($Context.Request.Url.AbsolutePath.TrimStart('/'))
  if ($Path -eq '') { $Path = 'index.html' }

  $File = Join-Path $Root $Path

  # If the request points at a folder, serve that folder's index.html.
  # This fixes /admin and /admin/ opening the admin dashboard.
  if ((Test-Path $File -PathType Container)) {
    $IndexFile = Join-Path $File 'index.html'
    if (Test-Path $IndexFile -PathType Leaf) {
      $File = $IndexFile
    }
  }

  if (Test-Path $File -PathType Leaf) {
    $Bytes = [System.IO.File]::ReadAllBytes($File)
    $Context.Response.ContentType = Get-ContentType $File
    $Context.Response.OutputStream.Write($Bytes,0,$Bytes.Length)
  } else {
    $Context.Response.StatusCode = 404
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
    $Context.Response.OutputStream.Write($Bytes,0,$Bytes.Length)
  }

  $Context.Response.Close()
}
