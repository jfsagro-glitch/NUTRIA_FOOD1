param(
  [string]$BaseUrl = 'http://127.0.0.1:3000'
)

$ErrorActionPreference = 'Stop'
$NoProxyHosts = 'localhost,127.0.0.1'

function New-TestImageBase64 {
  param(
    [string]$Label
  )

  Add-Type -AssemblyName System.Drawing

  $imagePath = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString() + '.jpg')
  $bitmap = New-Object System.Drawing.Bitmap 220, 220
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Beige)
      $font = New-Object System.Drawing.Font('Arial', 24, [System.Drawing.FontStyle]::Bold)
      try {
        $graphics.DrawString($Label, $font, [System.Drawing.Brushes]::SaddleBrown, 20, 90)
      } finally {
        $font.Dispose()
      }
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Save($imagePath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  } finally {
    $bitmap.Dispose()
  }

  try {
    return [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($imagePath))
  } finally {
    if (Test-Path $imagePath) {
      Remove-Item $imagePath -Force
    }
  }
}

function Invoke-CurlJsonPost {
  param(
    [string]$Url,
    [string]$Json,
    [string]$Token
  )

  $bodyPath = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString() + '.json')
  try {
    Set-Content -Path $bodyPath -Value $Json -Encoding UTF8
    $command = @('-s', '--noproxy', $NoProxyHosts, '-X', 'POST', $Url, '-H', 'Content-Type: application/json', '-d', "@$bodyPath")
    if ($Token) {
      $command += @('-H', "Cookie: token=$Token")
    }

    $responseText = & curl.exe @command
    if (-not $responseText) {
      throw 'Empty HTTP response.'
    }
    return $responseText | ConvertFrom-Json
  } finally {
    if (Test-Path $bodyPath) {
      Remove-Item $bodyPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function New-RecognitionBody {
  param(
    [string]$Label
  )

  $imageBase64 = New-TestImageBase64 -Label $Label
  return (@{
    image = @{
      data = $imageBase64
      mimeType = 'image/jpeg'
    }
    mode = 'ingredients'
  } | ConvertTo-Json -Depth 5 -Compress)
}

Write-Host '1. Logging in...'
$loginHeaderPath = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString() + '.headers.txt')
$loginBodyPath = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString() + '.body.json')
try {
  & curl.exe -s --noproxy $NoProxyHosts -D $loginHeaderPath -o $loginBodyPath -X POST "$BaseUrl/api/auth/login" -H 'Content-Type: application/json' -d '{}' | Out-Null
  if (-not (Test-Path $loginBodyPath) -or -not (Test-Path $loginHeaderPath)) {
    throw 'Login request did not produce response files.'
  }
  $login = Get-Content $loginBodyPath -Raw | ConvertFrom-Json
  if (-not $login.success) {
    throw 'Login failed.'
  }

  $setCookieHeader = [regex]::Match((Get-Content $loginHeaderPath -Raw), 'Set-Cookie:\s*([^\r\n]+)').Groups[1].Value
  if (-not $setCookieHeader -or $setCookieHeader -notmatch 'token=([^;]+)') {
    throw 'Token cookie not found.'
  }
  $token = ([string]$Matches[1]).Trim()
} finally {
  if (Test-Path $loginHeaderPath) {
    Remove-Item $loginHeaderPath -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $loginBodyPath) {
    Remove-Item $loginBodyPath -Force -ErrorAction SilentlyContinue
  }
}

Write-Host '2. Building synthetic test image and finding clean baseline...'
$candidateLabels = @('WAFFLE', 'MUFFIN', 'COOKIE', 'BAGEL', 'BROWNIE', 'CROISSANT')
$recognizeBody = $null
$firstItem = $null
$selectedLabel = $null

foreach ($candidateLabel in $candidateLabels) {
  $candidateBody = New-RecognitionBody -Label $candidateLabel
  $candidateResponse = Invoke-CurlJsonPost -Url "$BaseUrl/api/photo/recognize" -Json $candidateBody -Token $token
  if (-not $candidateResponse.items -or $candidateResponse.items.Count -eq 0) {
    continue
  }

  if ([string]$candidateResponse.items[0].matchedBy -ne 'correction') {
    $selectedLabel = $candidateLabel
    $recognizeBody = $candidateBody
    $firstItem = $candidateResponse.items[0]
    break
  }
}

if (-not $firstItem) {
  throw 'Could not find a clean baseline image that is not already affected by prior corrections.'
}

Write-Host ("3. First recognition with label " + $selectedLabel + '...')
$firstMatchedBy = [string]$firstItem.matchedBy
$firstMatchScore = [double]$firstItem.matchScore
$correctedProductId = 'ai-est-' + $selectedLabel.ToLowerInvariant() + '-corrected'

$correctionBody = @{
  sourceName = [string]$firstItem.name
  aliases = @(([string[]]$firstItem.aliases) + @($selectedLabel.ToLowerInvariant()))
  visibleText = @($selectedLabel)
  correctedProductId = $correctedProductId
  correctedProduct = @{
    id = $correctedProductId
    name = ($selectedLabel + ' corrected')
    brand = 'User Correction'
    calories = 452
    protein = 6
    fat = 24
    carbs = 51
    fiber = 1.9
    sugar = 24
    sodium = 380
    potassium = 120
    calcium = 28
    iron = 2.2
    magnesium = 14
    phosphorus = 95
    zinc = 0.8
    copper = 0.09
    manganese = 0.22
    selenium = 9
    vitaminA = 8
    vitaminC = 0
    vitaminD = 0
    vitaminE = 1.3
    vitaminK = 2
    vitaminB1 = 0.2
    vitaminB2 = 0.12
    vitaminB3 = 1.4
    vitaminB5 = 0.55
    vitaminB6 = 0.03
    vitaminB7 = 2.4
    vitaminB9 = 58
    vitaminB12 = 0.11
    cholesterol = 28
    omega3 = 0.04
    omega6 = 1.9
    transFat = 0.36
    saturatedFat = 10.1
    monounsaturatedFat = 8.6
    polyunsaturatedFat = 2.2
  }
} | ConvertTo-Json -Depth 6 -Compress

Write-Host '4. Saving correction...'
$correction = Invoke-CurlJsonPost -Url "$BaseUrl/api/photo/corrections" -Json $correctionBody -Token $token
if (-not $correction.success) {
  throw 'Correction save failed.'
}

Write-Host '5. Second recognition...'
$second = Invoke-CurlJsonPost -Url "$BaseUrl/api/photo/recognize" -Json $recognizeBody -Token $token
if (-not $second.items -or $second.items.Count -eq 0) {
  throw 'Second recognition returned no items.'
}

$secondItem = $second.items[0]
$secondMatchedBy = [string]$secondItem.matchedBy
$secondMatchScore = [double]$secondItem.matchScore

$result = [pscustomobject]@{
  label = $selectedLabel
  firstMatchedBy = $firstMatchedBy
  firstMatchScore = $firstMatchScore
  secondMatchedBy = $secondMatchedBy
  secondMatchScore = $secondMatchScore
  improved = ($secondMatchedBy -eq 'correction' -and $secondMatchScore -gt $firstMatchScore)
}

$result | ConvertTo-Json -Compress

if (-not $result.improved) {
  throw 'Smoke test failed: correction did not improve the match.'
}
