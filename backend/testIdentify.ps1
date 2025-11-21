# PowerShell script to test card identification API

$apiBase = "http://localhost:5000/api/cards"
$adminEmail = Read-Host "Enter admin email"
$adminPass = Read-Host "Enter admin password" -AsSecureString
$adminPassPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPass))

# 1️⃣ Login to get JWT token
try {
    $loginResp = Invoke-RestMethod -Method POST -Uri "$apiBase/../auth/login" -ContentType "application/json" -Body (@{ email = $adminEmail; password = $adminPassPlain } | ConvertTo-Json)
    Write-Host "✅ Logged in successfully!"
    $token = $loginResp.token
} catch {
    Write-Error "❌ Login failed: $($_.Exception.Message)"
    exit
}

# 2️⃣ Select card input mode
$mode = Read-Host "Select card input mode: 1 = Manual entry, 2 = Gemini AI (image identification)"

# Initialize request body
$body = @{ mode = $mode }

if ($mode -eq "1") {
    # Full manual entry
    $body.name = Read-Host "Enter card name"
    $body.set = Read-Host "Enter card set"
    $body.number = Read-Host "Enter card number (optional)"
    $body.rarity = Read-Host "Enter card rarity (optional)"
    $body.language = Read-Host "Enter card language (optional)"
    $body.condition = Read-Host "Enter card condition (NM, LP, etc.)"
    $body.marketPrice = Read-Host "Enter market price (optional)"
    $body.listedPrice = Read-Host "Enter listed price (optional)"
    $body.availability = Read-Host "Is card available? (true/false)"
    $body.imageUrl = Read-Host "Enter image URL (optional)"
}
 elseif ($mode -eq "2") {
    # Gemini AI
    $imagePath = Read-Host "Enter full path to card image (no quotes)"
    if (!(Test-Path $imagePath)) {
        Write-Error "❌ File does not exist"
        exit
    }

    # Convert image to Base64
    $bytes = [System.IO.File]::ReadAllBytes($imagePath)
    $base64 = [System.Convert]::ToBase64String($bytes)
    $body.base64Image = $base64
    $body.condition = Read-Host "Enter card condition (NM, LP, etc.)"
} else {
    Write-Error "❌ Invalid mode"
    exit
}

# 3️⃣ Call /identify endpoint
try {
    $response = Invoke-RestMethod -Method POST -Uri "$apiBase/identify" -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" } -Body ($body | ConvertTo-Json -Depth 5)
    Write-Host "✅ Card identified/added:"
    $response.card | Format-List
    if ($response.marketPrice) { Write-Host "💰 Market price: $($response.marketPrice)" }
} catch {
    Write-Error "❌ Error identifying card: $($_.Exception.Message)"
}
