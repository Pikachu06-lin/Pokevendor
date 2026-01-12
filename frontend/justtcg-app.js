// justtcg-app.js
// Unified Frontend Logic for JustTCG Japanese Card Upload

const API_BASE_URL = '/api/justtcg';

// State
let currentCards = [];
let allFoundCards = [];
let currentPage = 1;
const cardsPerPage = 10;
let authToken = null;
let selectedFile = null; // Store the selected/dropped file

// DOM Elements
const loginDiv = document.getElementById('loginDiv');
const uploadForm = document.getElementById('uploadForm');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const uploadBtn = document.getElementById('uploadBtn');
const cardImage = document.getElementById('cardImage');
const imagePreview = document.getElementById('imagePreview');
const dropZone = document.getElementById('dropZone');
const cardSelection = document.getElementById('cardSelection');
const cardList = document.getElementById('cardList');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const pagination = document.getElementById('pagination');

document.addEventListener('DOMContentLoaded', () => {

  // ---------- 1. Attach Upload Listener ----------
  if (uploadBtn) {
    uploadBtn.addEventListener('click', handleUpload);
  }

  // ---------- 2. Drag and Drop ----------
  if (dropZone) {
    dropZone.addEventListener('click', () => cardImage.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        selectedFile = files[0]; // Store the dropped file
        showPreview(files[0]);
      }
    });
  }

  // ---------- 3. File Input ----------
  cardImage.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedFile = file; // Store the selected file
      showPreview(file);
    }
  });

  function showPreview(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      imagePreview.src = e.target.result;
      imagePreview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }

  // ---------- 4. Login Logic ----------
  loginBtn.addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const loginMsg = document.getElementById('loginMsg');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok) {
        authToken = data.token;
        loginDiv.style.display = 'none';
        uploadForm.style.display = 'block';
      } else {
        loginMsg.innerHTML = `<div class="error">${data.error || 'Login failed'}</div>`;
      }
    } catch (err) {
      loginMsg.innerHTML = '<div class="error">Network error</div>';
    }
  });

  // ---------- 5. The Fixed Upload Handler ----------
  async function handleUpload() {
    const file = selectedFile || cardImage.files[0]; // Use stored file first
    const condition = document.getElementById('condition').value;
    const language = document.getElementById('language').value;
    const uploadMsgDiv = document.getElementById('uploadMsg');

    if (!file) {
      uploadMsgDiv.innerHTML = '<div class="error">❌ No image provided. Please select a file.</div>';
      return;
    }

    uploadBtn.disabled = true;
    uploadMsgDiv.innerHTML = '<div class="info">🤖 Processing image with AI...</div>';

    try {
      const formData = new FormData();
      formData.append('image', file); 
      formData.append('language', language);
      formData.append('cardName', document.getElementById('cardName').value.trim());

      const response = await fetch('/api/justtcg/identify-card', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + authToken
        },
        body: formData
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI identification failed");

      // Handle successful card identification
      if (data.cards && data.cards.length > 0) {
        currentCards = data.cards;
        allFoundCards = data.cards;
        currentPage = 1;
        displayCards();
        cardSelection.style.display = 'block';
        uploadMsgDiv.innerHTML = '<div class="success">✅ Card identified! Select a match below:</div>';
      } else {
        uploadMsgDiv.innerHTML = '<div class="error">❌ No matching cards found</div>';
      }
      
    } catch (err) {
      uploadMsgDiv.innerHTML = `<div class="error">❌ ${err.message}</div>`;
    } finally {
      uploadBtn.disabled = false;
    }
  }

  // ---------- Display Cards ----------
  function displayCards() {
    const start = (currentPage - 1) * cardsPerPage;
    const end = start + cardsPerPage;
    const paginated = currentCards.slice(start, end);

    cardList.innerHTML = '';
    paginated.forEach((card, idx) => {
      const li = document.createElement('li');

      const cardImg = card.image_url ?
        `<img src="${card.image_url}" alt="${card.name}" class="card-img" onerror="this.style.display='none'">` :
        '<div class="card-img" style="width:70px;height:98px;background:#ddd;display:flex;align-items:center;justify-content:center;font-size:10px;">No Image</div>';

      const cardInfo = `
        <div class="card-details">
          <strong>${card.name}</strong><br>
          <small>
            Set: ${card.set_name || 'Unknown'}<br>
            ${card.printing ? `Printing: ${card.printing}<br>` : ''}
            ${card.rarity ? `Rarity: ${card.rarity}<br>` : ''}
            ${card.condition ? `Condition: ${card.condition}<br>` : ''}
            Market Price: $${(card.price / 100).toFixed(2)}
          </small>
        </div>
      `;

      const priceInput = `
        <div class="price-input-container">
          <span class="price-label">List Price: $</span>
          <input type="number" id="price-${start + idx}" step="0.01" min="0" value="${(card.price / 100).toFixed(2)}">
        </div>
      `;

      const selectBtn = `<button onclick="selectCard(${start + idx})">Select This Card</button>`;

      li.innerHTML = cardImg + cardInfo + priceInput + selectBtn;
      cardList.appendChild(li);
    });

    const totalPages = Math.ceil(currentCards.length / cardsPerPage);
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage >= totalPages;
    pagination.style.display = totalPages > 1 ? 'flex' : 'none';
  }

  prevPageBtn.addEventListener('click', () => { 
    if (currentPage > 1) { 
      currentPage--; 
      displayCards(); 
    } 
  });
  
  nextPageBtn.addEventListener('click', () => { 
    if (currentPage * cardsPerPage < currentCards.length) { 
      currentPage++; 
      displayCards(); 
    } 
  });

  // ---------- Select Card ----------
  window.selectCard = async function(index) {
    const card = currentCards[index];
    const priceInput = document.getElementById(`price-${index}`);
    const listedPrice = parseFloat(priceInput.value);

    if (isNaN(listedPrice) || listedPrice < 0) return alert('Enter a valid price');

    const uploadMsg = document.getElementById('uploadMsg');
    uploadMsg.innerHTML = '<div class="info">💾 Saving card to inventory...</div>';

    try {
      const res = await fetch('/api/add-to-inventory', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          card: { ...card, listedPrice, source: 'justtcg' },
          condition: document.getElementById('condition').value,
          language: document.getElementById('language').value
        })
      });

      const data = await res.json();
      if (res.ok) {
        uploadMsg.innerHTML = '<div class="success">✓ Card added to inventory!</div>';
        setTimeout(() => {
          cardSelection.style.display = 'none';
          cardImage.value = '';
          imagePreview.style.display = 'none';
          document.getElementById('cardName').value = '';
          uploadMsg.innerHTML = '';
          currentCards = [];
          selectedFile = null; // Clear the stored file
        }, 2000);
      } else {
        uploadMsg.innerHTML = `<div class="error">${data.error || 'Failed to save card'}</div>`;
      }
    } catch (err) {
      console.error(err);
      uploadMsg.innerHTML = '<div class="error">Error saving card</div>';
    }
  };

});