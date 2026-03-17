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
  $bitmap = New-Object System.Drawing.Bitmap 260, 220
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Moccasin)
      $font = New-Object System.Drawing.Font('Arial', 22, [System.Drawing.FontStyle]::Bold)
      try {
        $graphics.DrawString($Label, $font, [System.Drawing.Brushes]::DarkOliveGreen, 20, 90)
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

function Invoke-CurlJsonGet {
  param(
    [string]$Url,
    [string]$Token
  )

  $command = @('-s', '--noproxy', $NoProxyHosts, '-X', 'GET', $Url)
  if ($Token) {
    $command += @('-H', "Cookie: token=$Token")
  }

  $responseText = & curl.exe @command
  if (-not $responseText) {
    throw 'Empty HTTP response.'
  }
  return $responseText | ConvertFrom-Json
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

Write-Host '2. Building synthetic whole dish image...'
$imageBase64 = New-TestImageBase64 -Label 'PASTA PLATE'
$recognizeBody = @{
  image = @{
    data = $imageBase64
    mimeType = 'image/jpeg'
  }
  mode = 'whole_dish'
} | ConvertTo-Json -Depth 5 -Compress

Write-Host '3. Running whole dish recognition...'
$recognized = Invoke-CurlJsonPost -Url "$BaseUrl/api/photo/recognize" -Json $recognizeBody -Token $token
if (-not $recognized.dishEstimate) {
  throw 'No dishEstimate in whole_dish mode response.'
}
if ([double]$recognized.dishEstimate.totalCalories -le 0 -or [double]$recognized.dishEstimate.amount -le 0) {
  throw 'dishEstimate has invalid calories or amount.'
}

$today = (Get-Date).ToString('yyyy-MM-dd')
$addBody = @{
  productId = [string]$recognized.dishEstimate.product.id
  usdaData = $recognized.dishEstimate.product
  amount = [double]$recognized.dishEstimate.amount
  type = 'LUNCH'
  date = $today
} | ConvertTo-Json -Depth 8 -Compress

Write-Host '4. Adding whole dish to diary...'
$added = Invoke-CurlJsonPost -Url "$BaseUrl/api/diary/add" -Json $addBody -Token $token
if (-not $added.id) {
  throw 'Diary add did not return meal item id.'
}

Write-Host '5. Verifying diary entry...'
$diary = Invoke-CurlJsonGet -Url "$BaseUrl/api/diary?date=$today" -Token $token
$hasAdded = $false
foreach ($meal in $diary.meals) {
  if ($meal.type -ne 'LUNCH') { continue }
  foreach ($item in $meal.items) {
    if ([string]$item.id -eq [string]$added.id) {
      $hasAdded = $true
      break
    }
  }
  if ($hasAdded) { break }
}

$result = [pscustomobject]@{
  mode = 'whole_dish'
  dishName = [string]$recognized.dishEstimate.name
  estimatedAmount = [double]$recognized.dishEstimate.amount
  totalCalories = [double]$recognized.dishEstimate.totalCalories
  addedItemId = [string]$added.id
  verifiedInDiary = $hasAdded
}

$result | ConvertTo-Json -Compress

if (-not $hasAdded) {
  throw 'Smoke test failed: added whole dish item not found in diary.'
}
