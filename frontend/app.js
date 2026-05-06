// app.js — PokéVendor frontend, powered by tcgapi.dev

// ===== CONFIG =====
const config = {
  backendUrl: 'http://localhost:5000',
  identifyAndSearchEndpoint: '/api/cards/identify-and-search',
  addCardEndpoint:           '/api/add-to-inventory',
  loginEndpoint:             '/api/login',
};

// ===== STATE =====
let token         = null;
let allFoundCards = [];   // tcgapi-formatted cards
let identifiedCard = null; // raw Gemini output
let currentPage   = 1;
const cardsPerPage = 20;

// ===== INIT =====

document.getElementById('cardImage').addEventListener('change', function (e) {
  const file    = e.target.files[0];
  const preview = document.getElementById('imagePreview');
  if (file) {
    const reader  = new FileReader();
    reader.onload = (e) => { preview.src = e.target.result; preview.style.display = 'block'; };
    reader.readAsDataURL(file);
  } else {
    preview.style.display = 'none';
  }
});

document.getElementById('loginBtn').addEventListener('click', handleLogin);
document.getElementById('logoutBtn').addEventListener('click', handleLogout);
document.getElementById('uploadBtn').addEventListener('click', handleUpload);
document.getElementById('prevPage').addEventListener('click', handlePrevPage);
document.getElementById('nextPage').addEventListener('click', handleNextPage);

document.getElementById('password').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});
document.getElementById('email').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

// ===== AUTH =====

async function handleLogin() {
  const email     = document.getElementById('email').value.trim();
  const password  = document.getElementById('password').value;
  const msgDiv    = document.getElementById('loginMsg');
  const btn       = document.getElementById('loginBtn');

  if (!email || !password) {
    showMessage(msgDiv, '❌ Please enter both email and password', 'error');
    return;
  }

  btn.disabled = true;
  showMessage(msgDiv, 'Logging in...', 'info');

  try {
    const res  = await fetch(config.backendUrl + config.loginEndpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Login failed');

    token = data.token;
    showMessage(msgDiv, '✅ Logged in!', 'success');

    setTimeout(() => {
      document.getElementById('loginDiv').style.display  = 'none';
      document.getElementById('uploadForm').style.display = 'block';
    }, 500);

  } catch (err) {
    showMessage(msgDiv, '❌ ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function handleLogout() {
  token         = null;
  allFoundCards = [];
  currentPage   = 1;
  identifiedCard = null;

  document.getElementById('uploadForm').style.display    = 'none';
  document.getElementById('loginDiv').style.display      = 'block';
  document.getElementById('cardSelection').style.display = 'none';
  document.getElementById('cardImage').value             = '';
  document.getElementById('cardName').value              = '';
  document.getElementById('imagePreview').style.display  = 'none';
  document.getElementById('uploadMsg').textContent       = '';
}

// ===== UPLOAD HANDLER =====

async function handleUpload() {
  const file      = document.getElementById('cardImage').files[0];
  const condition = document.getElementById('condition').value;
  const msgDiv    = document.getElementById('uploadMsg');
  const btn       = document.getElementById('uploadBtn');

  if (!file) {
    showMessage(msgDiv, '❌ Image file is required.', 'error');
    return;
  }

  btn.disabled = true;
  showMessage(msgDiv, '🤖 Identifying card with AI...', 'info');

  try {
    // Convert image to base64
    const base64 = await new Promise((resolve, reject) => {
      const reader  = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Check for manual name override — if set, we still need to search
    const manualName = document.getElementById('cardName').value.trim();

    let cards = [];

    if (manualName) {
      // Manual override: skip Gemini, search directly by name
      showMessage(msgDiv, `🔍 Searching for "${manualName}"...`, 'info');

      const res  = await fetch(
        config.backendUrl + '/api/cards/search-sheet?' +
        new URLSearchParams({ name: manualName, limit: 100 }).toString()
      );
      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'Search failed');

      cards = data.cards || [];
      identifiedCard = { name: manualName };

    } else {
      // Normal flow: one endpoint does Gemini + tcgapi.dev search
      showMessage(msgDiv, '🤖 Identifying card and searching for prices...', 'info');

      const res  = await fetch(config.backendUrl + config.identifyAndSearchEndpoint, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ base64Image: base64 }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || 'Identify & search failed');

      identifiedCard = data.identified; // { name, set, setNumber, rarity, language }
      cards          = data.cards || [];

      console.log('🤖 Gemini identified:', identifiedCard);
      console.log(`📦 TCG API returned ${cards.length} results`);
    }

    if (cards.length === 0) {
      throw new Error(`No matching cards found for "${identifiedCard?.name || manualName}"`);
    }

    allFoundCards = cards;
    currentPage   = 1;

    await displayCards(allFoundCards, currentPage, condition);

    document.getElementById('cardSelection').style.display = 'block';
    showMessage(msgDiv, `✅ Found ${cards.length} result(s) for "${identifiedCard.name}"`, 'success');

    const totalPages = Math.ceil(allFoundCards.length / cardsPerPage);
    document.getElementById('pagination').style.display = totalPages > 1 ? 'flex' : 'none';
    if (totalPages > 1) updatePaginationControls();

  } catch (err) {
    showMessage(msgDiv, '❌ ' + err.message, 'error');
    console.error('Upload error:', err);
  } finally {
    btn.disabled = false;
  }
}

// ===== DISPLAY CARDS (tcgapi.dev structure) =====

async function displayCards(cards, page, condition) {
  const startIdx  = (page - 1) * cardsPerPage;
  const pageCards = cards.slice(startIdx, startIdx + cardsPerPage);

  const listEl = document.getElementById('cardList');
  listEl.innerHTML = '<li style="text-align:center;padding:20px;">Loading inventory counts...</li>';

  // Fetch inventory counts in parallel
  const cardsWithInventory = await Promise.all(
    pageCards.map(async (c) => {
      const count = await fetchInventoryCount(c.name, c.set, c.number);
      return { ...c, inventoryCount: count };
    })
  );

  listEl.innerHTML = '';

  cardsWithInventory.forEach((c, idx) => {
    const globalIdx    = startIdx + idx;
    const marketPrice  = c.marketPrice;
    const defaultPrice = marketPrice ? marketPrice.toFixed(2) : '10.00';
    const priceNote    = marketPrice ? '' : ' (Market price unavailable — set manually)';
    const priceDisplay = marketPrice ? `$${marketPrice.toFixed(2)}` : 'N/A';

    const imageUrl = c.imageUrl || 'https://placehold.co/70x100/94A3B8/ffffff?text=No+Image';

    const inventoryBadge = c.inventoryCount > 0
      ? `<span style="background:#4CAF50;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:bold;margin-left:8px;">In Stock: ${c.inventoryCount}</span>`
      : `<span style="background:#f44336;color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:bold;margin-left:8px;">Not in Stock</span>`;

    const li = document.createElement('li');
    li.dataset.index = globalIdx;
    li.innerHTML = `
      <img src="${imageUrl}" alt="${c.name}" class="card-img"
           onerror="this.src='https://placehold.co/70x100/94A3B8/ffffff?text=No+Image'">
      <div class="card-details">
        <strong>${c.name}</strong>${inventoryBadge}<br>
        <small>${c.set || 'Unknown Set'} • #${c.number || '?'} • ${c.rarity || 'Unknown'}</small><br>
        <small>Market Price: ${priceDisplay}${priceNote}</small><br>
        ${c.lowPrice   ? `<small>Low: $${c.lowPrice.toFixed(2)}</small> &nbsp;` : ''}
        ${c.printing   ? `<small>Printing: ${c.printing}</small>` : ''}
      </div>
      <div class="price-input-container">
        <label class="price-label">List Price ($):</label>
        <input type="number" step="0.01" min="0.01" value="${defaultPrice}"
               class="listed-price-input">
        <label class="price-label" style="margin-top:8px;">Quantity:</label>
        <div class="quantity-control">
          <button type="button" class="qty-btn qty-minus">−</button>
          <input type="number" min="1" value="1" class="qty-input">
          <button type="button" class="qty-btn qty-plus">+</button>
        </div>
      </div>
      <button class="add-btn">Add to Inventory</button>
    `;
    listEl.appendChild(li);
  });

  setupCardButtons(condition);
}

function setupCardButtons(condition) {
  const listEl = document.getElementById('cardList');

  // Auto-format listed price to 2 decimal places on blur (e.g. "1" → "1.00")
  listEl.querySelectorAll('.listed-price-input').forEach(input => {
    input.addEventListener('blur', () => {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val > 0) input.value = val.toFixed(2);
    });
  });

  // Quantity +/- buttons
  listEl.querySelectorAll('.qty-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.closest('li').querySelector('.qty-input');
      const val   = parseInt(input.value) || 1;
      if (val > 1) input.value = val - 1;
    });
  });
  listEl.querySelectorAll('.qty-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.closest('li').querySelector('.qty-input');
      input.value = (parseInt(input.value) || 1) + 1;
    });
  });

  // Add to Inventory buttons — read inputs from same <li> to avoid index mismatch
  listEl.querySelectorAll('.add-btn').forEach((btn) => {
    btn.addEventListener('click', async function () {
      const li           = btn.closest('li');
      const idx          = parseInt(li.dataset.index);
      const selectedCard = allFoundCards[idx];

      const listedPrice  = parseFloat(li.querySelector('.listed-price-input')?.value);
      const quantity     = parseInt(li.querySelector('.qty-input')?.value) || 1;

      if (!listedPrice || listedPrice <= 0) {
        alert('❌ Please enter a valid listed price greater than $0.00.');
        return;
      }
      if (quantity < 1) {
        alert('❌ Quantity must be at least 1.');
        return;
      }

      btn.disabled    = true;
      btn.textContent = 'Adding...';

      try {
        await addCardToInventory(selectedCard, listedPrice, quantity, condition);
        alert(`✅ ${quantity > 1 ? quantity + 'x ' : ''}${selectedCard.name} added to inventory!`);

        // Reset UI
        document.getElementById('cardSelection').style.display = 'none';
        document.getElementById('cardImage').value             = '';
        document.getElementById('cardName').value              = '';
        document.getElementById('imagePreview').style.display  = 'none';
        document.getElementById('uploadMsg').textContent       = '';
        allFoundCards  = [];
        currentPage    = 1;
        identifiedCard = null;

      } catch (err) {
        alert('❌ Failed to add card: ' + err.message);
        btn.disabled    = false;
        btn.textContent = 'Add to Inventory';
      }
    });
  });
}

// ===== ADD TO INVENTORY (tcgapi.dev structure) =====

async function addCardToInventory(card, listedPrice, quantity, condition) {
  const cardLanguage = identifiedCard?.language || 'Unknown';

  // Use Gemini's set name — it's more accurate than TCGPlayer's internal naming.
  // Fall back to the API set name only if Gemini didn't identify one.
  const setName = identifiedCard?.set || card.set || 'Unknown Set';

  const payload = {
    card: {
      name:        card.name,
      set_name:    setName,
      number:      card.number     || '',
      rarity:      card.rarity     || 'Unknown',
      image_url:   card.imageUrl   || null,
      marketPrice: card.marketPrice ?? null,       // raw market price for reference
      listedPrice: listedPrice,                    // what the user set in the UI
      printing:    card.printing   || 'Normal',
      tcgplayerId: card.tcgplayerId || null,
      source:      'tcgapi',
    },
    quantity:  quantity,
    condition: condition,
    language:  cardLanguage,
  };

  console.log('📦 Adding to inventory:', payload);

  const res = await fetch(config.backendUrl + config.addCardEndpoint, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + token,
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || result.message || 'Server error');
  return result;
}

// ===== INVENTORY COUNT =====

async function fetchInventoryCount(cardName, setName, cardNumber) {
  try {
    const params = new URLSearchParams({ cardName });
    if (setName)    params.append('setName', setName);
    if (cardNumber) params.append('cardNumber', cardNumber);

    const res = await fetch(config.backendUrl + '/api/inventory/count?' + params.toString(), {
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (res.ok) {
      const data = await res.json();
      return data.count || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

// ===== PAGINATION =====

function updatePaginationControls() {
  const totalPages = Math.ceil(allFoundCards.length / cardsPerPage);
  document.getElementById('pageInfo').textContent     = `Page ${currentPage} of ${totalPages}`;
  document.getElementById('prevPage').disabled        = currentPage === 1;
  document.getElementById('nextPage').disabled        = currentPage === totalPages;
}

function handlePrevPage() {
  if (currentPage > 1) {
    currentPage--;
    const condition = document.getElementById('condition').value;
    displayCards(allFoundCards, currentPage, condition);
    updatePaginationControls();
    document.getElementById('cardList').scrollIntoView({ behavior: 'smooth' });
  }
}

function handleNextPage() {
  const totalPages = Math.ceil(allFoundCards.length / cardsPerPage);
  if (currentPage < totalPages) {
    currentPage++;
    const condition = document.getElementById('condition').value;
    displayCards(allFoundCards, currentPage, condition);
    updatePaginationControls();
    document.getElementById('cardList').scrollIntoView({ behavior: 'smooth' });
  }
}

// ===== UTILITIES =====

function showMessage(element, message, type) {
  element.textContent = message;
  element.className   = type;
}