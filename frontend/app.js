// Configuration
const config = {
  backendUrl: "http://localhost:5000",
  loginEndpoint: "/api/login",
  identifyImageEndpoint: "/api/cards/identify-image",
  addCardEndpoint: "/api/add-to-inventory"
};

// State
let token = null;
let allFoundCards = [];
let currentPage = 1;
const cardsPerPage = 20;

// ===== UI EVENT LISTENERS =====

document.getElementById('cardImage').addEventListener('change', function(e) {
  const file = e.target.files[0];
  const preview = document.getElementById('imagePreview');
  
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      preview.src = e.target.result;
      preview.style.display = 'block';
    };
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

document.getElementById('password').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

document.getElementById('email').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

// ===== AUTH HANDLERS =====

async function handleLogin() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const loginMsgDiv = document.getElementById('loginMsg');
  const loginBtn = document.getElementById('loginBtn');

  if (!email || !password) {
    showMessage(loginMsgDiv, "❌ Please enter both email and password", "error");
    return;
  }

  loginBtn.disabled = true;
  showMessage(loginMsgDiv, "Logging in...", "info");

  try {
    const response = await fetch(config.backendUrl + config.loginEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || "Login failed");
    }

    token = data.token;
    showMessage(loginMsgDiv, "✅ Logged in successfully!", "success");
    
    setTimeout(() => {
      document.getElementById('uploadForm').style.display = "block";
      document.getElementById('loginDiv').style.display = "none";
    }, 500);

  } catch(err) {
    showMessage(loginMsgDiv, "❌ " + err.message, "error");
    console.error("Login error:", err);
  } finally {
    loginBtn.disabled = false;
  }
}

function handleLogout() {
  token = null;
  document.getElementById('uploadForm').style.display = "none";
  document.getElementById('loginDiv').style.display = "block";
  document.getElementById('cardSelection').style.display = "none";
  document.getElementById('cardImage').value = '';
  document.getElementById('imagePreview').style.display = 'none';
  document.getElementById('uploadMsg').textContent = '';
  allFoundCards = [];
  currentPage = 1;
}

// ===== CARD IDENTIFICATION =====

async function identifyCardWithBackend(base64Image, targetLanguage) {
  const manualName = document.getElementById('cardName').value.trim();
  
  if (manualName) {
    return { name: manualName, set: null, setNumber: null, confidence: 1.0 };
  }
  
  try {
    const response = await fetch(config.backendUrl + config.identifyImageEndpoint, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({ 
        base64Image: base64Image,
        language: targetLanguage 
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || data.details || "AI identification failed");
    }
    
    console.log("✅ AI Identified Card:", data.card);
    return data.card;
    
  } catch (err) {
    console.error("Backend identification error:", err);
    throw new Error("AI identification failed: " + err.message);
  }
}

// ===== TCGDEX API =====

async function fetchCardsFromTCGdex(name, setName, language) {
  if (!name) return [];
  
  try {
    console.log("Searching TCGdex for:", name, "(Language:", language + ")");
    
    const cardsUrl = "https://api.tcgdex.net/v2/" + language + "/cards";
    const response = await fetch(cardsUrl);
    
    if (!response.ok) {
      throw new Error("TCGdex API error: " + response.status);
    }
    
    const allCards = await response.json();
    console.log("TCGdex returned", allCards.length, "total cards");
    
    const nameLower = name.toLowerCase().trim();
    const nameVariations = [
      nameLower,
      nameLower.replace(/&/g, '＆'),
      nameLower.replace(/&/g, 'and'),
      nameLower.replace(/&/g, ' '),
      nameLower.replace(/\s+/g, ''),
      nameLower.replace(/[&＆]/g, '')
    ];
    
    let matchingCards = allCards.filter(card => {
      if (!card.name) return false;
      const cardNameLower = card.name.toLowerCase();
      return nameVariations.some(v => cardNameLower.includes(v) || v.includes(cardNameLower));
    });
    
    if (matchingCards.length === 0) {
      const keywords = nameLower.split(/[\s&＆]+/).filter(w => w.length > 2);
      matchingCards = allCards.filter(card => {
        if (!card.name) return false;
        const cardNameLower = card.name.toLowerCase();
        const matchCount = keywords.filter(k => cardNameLower.includes(k)).length;
        return matchCount >= Math.max(1, keywords.length - 1);
      });
    }
    
    console.log("Found", matchingCards.length, "cards matching name");
    
    if (setName && matchingCards.length > 0) {
      const setLower = setName.toLowerCase().trim();
      const setFiltered = matchingCards.filter(card => {
        const cardSetName = (card.set && card.set.name && card.set.name.toLowerCase()) || '';
        const cardSetId = (card.set && card.set.id && card.set.id.toLowerCase()) || '';
        return cardSetName.includes(setLower) || cardSetId.includes(setLower);
      });
      
      if (setFiltered.length > 0) {
        matchingCards = setFiltered;
      }
    }
    
    if (matchingCards.length === 0) {
      return [];
    }
    
    const detailedCards = await Promise.all(
      matchingCards.slice(0, 100).map(async card => {
        try {
          if (!card.id) return card;
          
          const detailUrl = "https://api.tcgdex.net/v2/" + language + "/cards/" + card.id;
          const detailResp = await fetch(detailUrl);
          
          if (detailResp.ok) {
            return await detailResp.json();
          }
          return card;
        } catch (err) {
          console.error("Error fetching details:", err);
          return card;
        }
      })
    );
    
    const validCards = detailedCards.filter(c => c !== null && c !== undefined);
    console.log("Successfully fetched", validCards.length, "detailed cards");
    return validCards;
    
  } catch (err) {
    console.error("TCGdex API fetch error:", err);
    throw err;
  }
}

// ===== SORTING & PRICING =====

function sortCardsByRelevance(cards, searchName) {
  const searchLower = searchName.toLowerCase();
  
  return cards.sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();
    
    if (aName === searchLower && bName !== searchLower) return -1;
    if (bName === searchLower && aName !== searchLower) return 1;
    
    const specialSuffixes = ['gx', 'ex', 'v', 'vmax', 'vstar', 'vunion', 'break', 'prime'];
    const searchHasSpecial = specialSuffixes.some(s => searchLower.includes(s));
    
    if (searchHasSpecial) {
      const aHasSpecial = specialSuffixes.some(s => aName.includes(s));
      const bHasSpecial = specialSuffixes.some(s => bName.includes(s));
      
      if (aHasSpecial && !bHasSpecial) return -1;
      if (bHasSpecial && !aHasSpecial) return 1;
    }
    
    if (aName.startsWith(searchLower) && !bName.startsWith(searchLower)) return -1;
    if (bName.startsWith(searchLower) && !aName.startsWith(searchLower)) return 1;
    
    const aSetId = a.set && a.set.id ? a.set.id : '';
    const bSetId = b.set && b.set.id ? b.set.id : '';
    if (aSetId > bSetId) return -1;
    if (bSetId > aSetId) return 1;
    
    return aName.localeCompare(bName);
  });
}

function extractMarketPrice(card) {
  try {
    if (card.pricing) {
      if (card.pricing.tcgplayer) {
        const tcp = card.pricing.tcgplayer;
        
        if (tcp.holofoil && tcp.holofoil.marketPrice) {
          return tcp.holofoil.marketPrice.toFixed(2);
        }
        if (tcp.reverseHolofoil && tcp.reverseHolofoil.marketPrice) {
          return tcp.reverseHolofoil.marketPrice.toFixed(2);
        }
        if (tcp.normal && tcp.normal.marketPrice) {
          return tcp.normal.marketPrice.toFixed(2);
        }
        if (tcp['1stEdition'] && tcp['1stEdition'].marketPrice) {
          return tcp['1stEdition'].marketPrice.toFixed(2);
        }
        if (tcp.unlimitedHolofoil && tcp.unlimitedHolofoil.marketPrice) {
          return tcp.unlimitedHolofoil.marketPrice.toFixed(2);
        }
      }
      
      if (card.pricing.cardmarket) {
        const cm = card.pricing.cardmarket;
        if (cm.avg) return cm.avg.toFixed(2);
        if (cm.trend) return cm.trend.toFixed(2);
        if (cm.low) return cm.low.toFixed(2);
      }
    }
    
    return null;
  } catch (err) {
    console.error("Error extracting price:", err);
    return null;
  }
}

// ===== FETCH INVENTORY COUNT =====

async function fetchInventoryCount(cardName, setName, cardNumber) {
  try {
    const params = new URLSearchParams({
      cardName: cardName
    });
    if (setName) {
      params.append('setName', setName);
    }
    if (cardNumber) {
      params.append('cardNumber', cardNumber);
    }

    const response = await fetch(config.backendUrl + '/api/inventory/count?' + params.toString(), {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.count || 0;
    }
    return 0;
  } catch (err) {
    console.error('Error fetching inventory count:', err);
    return 0;
  }
}

// ===== DISPLAY & PAGINATION =====

async function displayCards(cards, page, language, condition) {
  const startIdx = (page - 1) * cardsPerPage;
  const endIdx = startIdx + cardsPerPage;
  const pageCards = cards.slice(startIdx, endIdx);
  
  const listEl = document.getElementById('cardList');
  listEl.innerHTML = '<li style="text-align: center; padding: 20px;">Loading inventory counts...</li>';
  
  // Fetch inventory counts for all cards
  const cardsWithInventory = await Promise.all(
    pageCards.map(async (c) => {
      const cardNumber = c.localId || c.id || null;
      const setName = (c.set && c.set.name) || null;
      const count = await fetchInventoryCount(c.name, setName, cardNumber);
      return { ...c, inventoryCount: count };
    })
  );
  
  listEl.innerHTML = '';
  
  cardsWithInventory.forEach((c, idx) => {
    const globalIdx = startIdx + idx;
    const li = document.createElement('li');
    
    const marketPrice = extractMarketPrice(c);
    const defaultPrice = marketPrice || '10.00';
    const priceNote = marketPrice ? '' : ' (Market price unavailable - please set manually)';
    
    let imageUrl = 'https://placehold.co/70x100/94A3B8/ffffff?text=No+Image';
    
    if (c.image) {
      if (typeof c.image === 'string') {
        imageUrl = c.image + '/high.webp';
      } else if (typeof c.image === 'object') {
        if (c.image.small) imageUrl = c.image.small;
        else if (c.image.high) imageUrl = c.image.high;
      }
    }
    
    const imageFallback = c.image ? c.image + '/high.jpg' : imageUrl;
    const cardName = c.name || 'Unknown';
    const setName = (c.set && c.set.name) || 'Unknown Set';
    const cardNumber = c.localId || c.id || '?';
    const cardRarity = c.rarity || 'Unknown';
    const priceDisplay = marketPrice ? '$' + marketPrice : 'N/A';
    const inventoryCount = c.inventoryCount || 0;
    const inventoryBadge = inventoryCount > 0 
      ? '<span style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; margin-left: 8px;">In Stock: ' + inventoryCount + '</span>'
      : '<span style="background: #f44336; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; margin-left: 8px;">Not in Stock</span>';
    
    li.innerHTML = '<img src="' + imageUrl + '" alt="' + cardName + '" class="card-img" onerror="this.onerror=null; this.src=\'' + imageFallback + '\'; if(this.src===\'' + imageFallback + '\') this.onerror=function(){this.src=\'https://placehold.co/70x100/94A3B8/ffffff?text=No+Image\';};">' +
      '<div class="card-details">' +
        '<strong>' + cardName + '</strong>' + inventoryBadge + '<br>' +
        '<small>' + setName + ' • #' + cardNumber + ' • ' + cardRarity + '</small><br>' +
        '<small>Market Price: ' + priceDisplay + priceNote + '</small>' +
      '</div>' +
      '<div class="price-input-container">' +
        '<label class="price-label">List Price ($):</label>' +
        '<input type="number" step="0.01" min="0.01" value="' + defaultPrice + '" class="listed-price-input" data-index="' + globalIdx + '">' +
      '</div>' +
      '<button data-index="' + globalIdx + '">Add to Inventory</button>';
    
    listEl.appendChild(li);
  });

  setupCardButtons(language, condition);
}

function setupCardButtons(language, condition) {
  const listEl = document.getElementById('cardList');
  listEl.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async function() {
      const idx = parseInt(btn.dataset.index);
      const selectedCard = allFoundCards[idx];
      
      const priceInput = document.querySelector('.listed-price-input[data-index="' + idx + '"]');
      const listedPriceRaw = priceInput ? priceInput.value : null;
      
      if (!listedPriceRaw || isNaN(parseFloat(listedPriceRaw)) || parseFloat(listedPriceRaw) <= 0) {
        alert("❌ Please enter a valid listed price greater than $0.00.");
        return;
      }
      const listedPrice = parseFloat(listedPriceRaw);
      
      btn.disabled = true;
      btn.textContent = 'Adding...';
      
      try {
        await addCardToInventory(selectedCard, listedPrice, language, condition);
        
        alert("✅ Card added to inventory!");
        
        document.getElementById('cardSelection').style.display = 'none';
        document.getElementById('cardImage').value = '';
        document.getElementById('cardName').value = '';
        document.getElementById('imagePreview').style.display = 'none';
        document.getElementById('uploadMsg').textContent = "";
        allFoundCards = [];
        currentPage = 1;
        
      } catch(err) {
        alert("❌ Failed to add card: " + err.message);
        console.error("Add card error:", err);
        btn.disabled = false;
        btn.textContent = 'Add to Inventory';
      }
    });
  });
}

async function addCardToInventory(card, listedPrice, language, condition) {
  const marketPrice = extractMarketPrice(card);
  
  let imageUrl = null;
  if (card.image) {
    if (typeof card.image === 'string') {
      imageUrl = card.image + '/high.webp';
    } else if (card.image.small) {
      imageUrl = card.image.small;
    } else if (card.image.high) {
      imageUrl = card.image.high;
    }
  }
  
  const cardPayload = {
    card: {
      name: card.name,
      set_name: (card.set && card.set.name) || 'Unknown Set',
      number: card.localId || card.id || '',
      rarity: card.rarity || 'Unknown',
      image_url: imageUrl,
      price: marketPrice ? parseFloat(marketPrice) * 100 : 0,
      source: 'tcgdex',
      listedPrice: listedPrice
    },
    condition: condition,
    language: language === 'ja' ? 'Japanese' : (language === 'en' ? 'English' : language)
  };
  
  console.log("Sending card payload:", cardPayload);
  
  const response = await fetch(config.backendUrl + config.addCardEndpoint, {
    method: "POST",
    headers: { 
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(cardPayload)
  });

  const result = await response.json();
  
  if (!response.ok) {
    throw new Error(result.error || result.message || "Server error");
  }
  
  return result;
}

function updatePaginationControls() {
  const totalPages = Math.ceil(allFoundCards.length / cardsPerPage);
  document.getElementById('pageInfo').textContent = "Page " + currentPage + " of " + totalPages;
  document.getElementById('prevPage').disabled = currentPage === 1;
  document.getElementById('nextPage').disabled = currentPage === totalPages;
}

function handlePrevPage() {
  if (currentPage > 1) {
    currentPage--;
    const language = document.getElementById('language').value;
    const condition = document.getElementById('condition').value;
    displayCards(allFoundCards, currentPage, language, condition);
    updatePaginationControls();
    document.getElementById('cardList').scrollIntoView({ behavior: 'smooth' });
  }
}

function handleNextPage() {
  const totalPages = Math.ceil(allFoundCards.length / cardsPerPage);
  if (currentPage < totalPages) {
    currentPage++;
    const language = document.getElementById('language').value;
    const condition = document.getElementById('condition').value;
    displayCards(allFoundCards, currentPage, language, condition);
    updatePaginationControls();
    document.getElementById('cardList').scrollIntoView({ behavior: 'smooth' });
  }
}

// ===== UPLOAD HANDLER =====

async function handleUpload() {
  const file = document.getElementById('cardImage').files[0];
  const condition = document.getElementById('condition').value;
  const language = document.getElementById('language').value;
  const uploadMsgDiv = document.getElementById('uploadMsg');
  const uploadBtn = document.getElementById('uploadBtn');

  if (!file) {
    showMessage(uploadMsgDiv, "❌ Image file is required.", "error");
    return;
  }

  uploadBtn.disabled = true;
  showMessage(uploadMsgDiv, "🤖 Processing image with AI...", "info");

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const aiCard = await identifyCardWithBackend(base64, language);
    if (!aiCard || !aiCard.name) {
      throw new Error("AI failed to identify card.");
    }

    showMessage(uploadMsgDiv, "🔍 Searching for " + aiCard.name + " in database...", "info");
    
    let cards = [];
    let source = '';

    // Step 1: Try Google Sheets first
    try {
      const sheetResponse = await fetch(config.backendUrl + '/api/cards/search-sheet?name=' + 
        encodeURIComponent(aiCard.name) + '&limit=100');
      const sheetData = await sheetResponse.json();
      
      if (sheetData.success && sheetData.cards && sheetData.cards.length > 0) {
        cards = sheetData.cards;
        source = 'Google Sheets';
        console.log('✅ Using Google Sheets results:', cards.length, 'cards');
      } else if (sheetData.useTCGdex) {
        console.log('⚠️ Google Sheets empty, falling back to TCGdex');
      }
    } catch (sheetError) {
      console.log('Google Sheets failed, using TCGdex:', sheetError);
    }

    // Step 2: If no results from Google Sheets, use TCGdex
    if (cards.length === 0) {
      source = 'TCGdex';
      cards = await fetchCardsFromTCGdex(aiCard.name, aiCard.set, language);
    }
    
    if (cards.length === 0) {
      throw new Error("No matching cards found for " + aiCard.name);
    }

    const sortedCards = sortCardsByRelevance(cards, aiCard.name);
    allFoundCards = sortedCards;
    currentPage = 1;

    await displayCards(allFoundCards, currentPage, language, condition);

    document.getElementById('cardSelection').style.display = 'block';
    showMessage(uploadMsgDiv, "✅ Found " + cards.length + " cards from " + source, "success");
    
    const totalPages = Math.ceil(allFoundCards.length / cardsPerPage);
    if (totalPages > 1) {
      document.getElementById('pagination').style.display = 'flex';
      updatePaginationControls();
    } else {
      document.getElementById('pagination').style.display = 'none';
    }

  } catch(err) {
    showMessage(uploadMsgDiv, "❌ " + err.message, "error");
    console.error("Upload error:", err);
  } finally {
    uploadBtn.disabled = false;
  }
}

// ===== UTILITIES =====

function showMessage(element, message, type) {
  element.textContent = message;
  element.className = type;
}