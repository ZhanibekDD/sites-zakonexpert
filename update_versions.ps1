Set-Location 'C:\Users\Администратор\Desktop\ZakonExpert.kz\public'
$files = Get-ChildItem -Filter '*.html' -Recurse
foreach ($file in $files) {
  $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
  $updated = $content
  $updated = $updated -replace 'landing\.css\?v=20260503-\d+', 'landing.css?v=20260504-2'
  $updated = $updated -replace 'landing\.css\?v=20260504-1', 'landing.css?v=20260504-2'
  $updated = $updated -replace 'style\.css\?v=20260503-\d+', 'style.css?v=20260504-2'
  $updated = $updated -replace 'style\.css\?v=20260504-1', 'style.css?v=20260504-2'
  $updated = $updated -replace 'legal\.css\?v=20260503-\d+', 'legal.css?v=20260504-2'
  $updated = $updated -replace 'legal\.css\?v=20260504-1', 'legal.css?v=20260504-2'
  $updated = $updated -replace 'site\.js\?v=20260503-\d+', 'site.js?v=20260504-2'
  $updated = $updated -replace 'site\.js\?v=20260504-1', 'site.js?v=20260504-2'
  $updated = $updated -replace 'main\.js\?v=20260503-\d+', 'main.js?v=20260504-2'
  $updated = $updated -replace 'main\.js\?v=20260504-1', 'main.js?v=20260504-2'
  if ($updated -ne $content) {
    [System.IO.File]::WriteAllText($file.FullName, $updated, [System.Text.Encoding]::UTF8)
    Write-Host "Updated: $($file.Name)"
  }
}
Write-Host "Done"
