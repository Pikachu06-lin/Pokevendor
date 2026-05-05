// server.js
// Main server file — uses tcgapi.dev for card lookups (replaces Supabase catalog)

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// IMPORTANT: Load environment variables FIRST before any other imports
dotenv.config();

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Now import modules that need env variables
import supabaseInventory from './services/supabase-inventory.js';
import { identifyCardFromBase64 } from './services/gemini.js';
import { searchCardInTCGAPI } from './services/tcgapi-service.js'; // ← replaced supabase-catalog-service

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from frontend folder
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ---------------------------------------------------------------------------
// Card Search — now powered by tcgapi.dev
// ---------------------------------------------------------------------------
app.get('/api/cards/search-sheet', async (req, res) => {
  try {
    const { name, set, cardNumber, language, limit } = req.query;

    if (!name) {
      return res.status(400).json({ error: 'Card name is required' });
    }

    const cards = await searchCardInTCGAPI(
      name,
      set || '',
      cardNumber || '',
      language || 'English',
      parseInt(limit) || 20
    );

    return res.json({
      success: true,
      cards: cards,
      count: cards.length,
      source: 'tcgapi',
    });

  } catch (error) {
    console.error('Error in card search:', error);
    res.status(500).json({
      success: false,
      error: 'Card search failed',
      details: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// AI Card Identification — Gemini vision (unchanged)
// ---------------------------------------------------------------------------
app.post('/api/cards/identify-image', async (req, res) => {
  try {
    const { base64Image, language } = req.body;

    if (!base64Image) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    const cardData = await identifyCardFromBase64(base64Image, language || 'en');

    res.json({
      success: true,
      card: {
        name: cardData.name,
        set: cardData.set,
        setNumber: cardData.setNumber,
        rarity: cardData.rarity,
        language: cardData.language,
        confidence: 1.0,
      },
    });

  } catch (error) {
    console.error('Error identifying card:', error);
    res.status(500).json({
      error: 'AI identification failed',
      details: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Combined identify + search endpoint (one round trip from the frontend)
// Calls Gemini then immediately searches tcgapi.dev
// ---------------------------------------------------------------------------
app.post('/api/cards/identify-and-search', async (req, res) => {
  try {
    const { base64Image } = req.body;

    if (!base64Image) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    // Step 1: Gemini identifies the card
    const cardData = await identifyCardFromBase64(base64Image);
    console.log('🤖 Gemini identified:', cardData);

    // Step 2: Search tcgapi.dev using extracted fields
    const cards = await searchCardInTCGAPI(
      cardData.name,
      cardData.set || '',
      cardData.setNumber || '',
      cardData.language || 'English',
      20
    );

    res.json({
      success: true,
      identified: cardData,       // Raw Gemini output (name, set, setNumber, language)
      cards: cards,               // tcgapi.dev matches with prices
      count: cards.length,
      source: 'tcgapi',
    });

  } catch (error) {
    console.error('Error in identify-and-search:', error);
    res.status(500).json({
      error: 'Identify and search failed',
      details: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
app.post('/api/login', async (req, res) => {
  console.log('Login attempt received:', req.body);
  try {
    const { email, password } = req.body;

    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASS) {
      const token = 'demo-token-' + Date.now();
      console.log('Login successful!');
      res.json({ success: true, token, message: 'Login successful' });
    } else {
      console.log('Invalid credentials');
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// ---------------------------------------------------------------------------
// Inventory (unchanged — still uses Supabase for storing cards)
// ---------------------------------------------------------------------------
app.post('/api/add-to-inventory', async (req, res) => {
  try {
    const { card, condition, language } = req.body;

    if (!card) {
      return res.status(400).json({ error: 'Card data is required' });
    }

    const inventoryItem = {
      card: card,
      condition: condition,
      language: language,
      source: card.source || 'tcgapi',
    };

    const savedItem = await supabaseInventory.addCard(inventoryItem);

    res.json({
      success: true,
      message: 'Card added to inventory successfully',
      item: savedItem,
    });

  } catch (error) {
    console.error('Error adding to inventory:', error);
    res.status(500).json({
      error: 'Failed to add card to inventory',
      details: error.message,
    });
  }
});

app.get('/api/inventory/count', async (req, res) => {
  try {
    const { cardName, setName, cardNumber } = req.query;

    if (!cardName) {
      return res.status(400).json({ error: 'Card name is required' });
    }

    let count = 0;
    try {
      count = await supabaseInventory.getCardCount(cardName, setName, cardNumber);
    } catch (countError) {
      // Don't crash the request — inventory count is non-critical for the UI
      console.warn(`⚠️  Could not get inventory count for "${cardName}":`, countError.message || countError);
    }

    res.json({ success: true, cardName, setName, cardNumber, count });

  } catch (error) {
    console.error('Error getting inventory count:', error);
    res.json({ success: true, count: 0 }); // always return 0 rather than breaking the UI
  }
});

app.get('/api/inventory', async (req, res) => {
  try {
    const filters = {
      cardName: req.query.cardName,
      setName: req.query.setName,
      language: req.query.language,
      condition: req.query.condition,
      source: req.query.source,
    };

    Object.keys(filters).forEach((key) => {
      if (filters[key] === undefined) delete filters[key];
    });

    const items = Object.keys(filters).length > 0
      ? await supabaseInventory.getItems(filters)
      : await supabaseInventory.getAllItems();

    res.json({ success: true, items, count: items.length });

  } catch (error) {
    console.error('Error getting inventory:', error);
    res.status(500).json({
      error: 'Failed to get inventory',
      details: error.message,
    });
  }
});

app.get('/api/inventory/stats', async (req, res) => {
  try {
    const stats = await supabaseInventory.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error getting inventory stats:', error);
    res.status(500).json({
      error: 'Failed to get inventory stats',
      details: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apis: {
      cardLookup: 'tcgapi.dev',
      inventory: 'supabase',
      cardIdentification: 'gemini',
    },
    timestamp: new Date().toISOString(),
  });
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   🎴 PokéVendor Server Running                           ║
  ║                                                           ║
  ║   Port: ${PORT}                                             ║
  ║                                                           ║
  ║   Card Upload:   http://localhost:${PORT}                 ║
  ║   Health:        http://localhost:${PORT}/api/health      ║
  ║   Inventory:     http://localhost:${PORT}/api/inventory/stats  ║
  ║                                                           ║
  ║   📊 Data Sources:                                        ║
  ║   1. tcgapi.dev  (card lookup + pricing)                 ║
  ║   2. Supabase    (inventory storage)                     ║
  ║   3. Gemini      (card image identification)             ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `);
});