# Run this script before deploying to bust the browser cache.
# It replaces the ?v= number in every HTML file with the current
# Unix timestamp so all CSS/JS URLs are unique per deploy.
param(
  [string]$Path = "$PSScriptRoot\frontend"
)

$version = [int][double]::Parse((Get-Date -UFormat %s))
Write-Host "Setting cache-bust version: $version"

$files = Get-ChildItem -Path $Path -Recurse -Filter "*.html"
$count = 0
foreach ($file in $files) {
  $content = Get-Content -LiteralPath $file.FullName -Raw
  if ($content -match '\?v=\d+') {
    $content = $content -replace '\?v=\d+', "?v=$version"
    Set-Content -LiteralPath $file.FullName -Value $content -NoNewline
    $count++
  }
}

Write-Host "Updated $count file(s)."
