# ============================================================
# updateCard.ps1 — Edit Cards in Database (Interactive)
# ============================================================

$baseAuth = "http://localhost:5000/api/auth"
$baseCards = "http://localhost:5000/api/cards"

Write-Host "=== Admin Login ==="
$email = Read-Host "Enter admin email"
$plainPassword = Read-Host "Enter admin password" -AsSecureString
$body = @{
    email = $email
    password = $plainPassword
}

# Login and get token
try {
    $loginResponse = Invoke-RestMethod `
        -Uri "$baseAuth/login" `
        -Method POST `
        -Body ($body | ConvertTo-Json) `
        -ContentType "application/json"
} catch {
    Write-Host "❌ Login failed: $($_.Exception.Message)"
    exit
}

$token = $loginResponse.token
if (-not $token) {
    Write-Host "❌ Login failed (no token returned)."
    exit
}

Write-Host "✅ Logged in successfully!"

# Fetch cards
Write-Host "`n=== Fetching cards... ==="
try {
    $cards = Invoke-RestMethod `
        -Uri $baseCards `
        -Headers @{ Authorization = "Bearer $token" }
} catch {
    Write-Host "❌ Failed to fetch cards: $($_.Exception.Message)"
    exit
}

if ($cards.Count -eq 0) {
    Write-Host "No cards found."
    exit
}

# List cards
Write-Host "`n=== Cards in Database ==="
for ($i=0; $i -lt $cards.Count; $i++) {
    $c = $cards[$i]
    
    # Support both id and _id
    $cid = $c._id
    if (-not $cid) { $cid = $c.id }

    Write-Host "[$i] $($c.name) — $($c.set) — $($c.condition) — ID: $cid"
}

# Choose card
$choice = Read-Host "`nEnter card number to edit"
if ($choice -notmatch "^\d+$" -or $choice -lt 0 -or $choice -ge $cards.Count) {
    Write-Host "❌ Invalid selection."
    exit
}

$card = $cards[$choice]

# Extract ID (support both)
$cardId = $card._id
if (-not $cardId) { $cardId = $card.id }

if (-not $cardId) {
    Write-Host "❌ Card has no ID — cannot update."
    exit
}

Write-Host "`nEditing card: $($card.name) ($cardId)"

# Interactive field updates
function EditField($label, $current) {
    $new = Read-Host "$label (current: '$current') — leave blank to keep"
    if ($new -eq "") { return $current }
    return $new
}

$updated = @{
    name        = EditField "Name" $card.name
    set         = EditField "Set" $card.set
    number      = EditField "Card Number" $card.number
    rarity      = EditField "Rarity" $card.rarity
    language    = EditField "Language" $card.language
    condition   = EditField "Condition" $card.condition
    marketPrice = EditField "Market Price" $card.marketPrice
    listedPrice = EditField "Listed Price" $card.listedPrice
    available   = EditField "Available (true/false)" $card.available
    imageUrl    = EditField "Image URL" $card.imageUrl
}

# Send update
Write-Host "`n=== Updating card ==="

try {
    $response = Invoke-RestMethod `
        -Uri "$baseCards/$cardId" `
        -Method PUT `
        -Headers @{ 
            Authorization = "Bearer $token"
            "Content-Type" = "application/json"
        } `
        -Body ($updated | ConvertTo-Json -Depth 10)
} catch {
    Write-Host "❌ Update failed: $($_.Exception.Message)"
    exit
}

Write-Host "`n✅ Card updated successfully!"
$response
