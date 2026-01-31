/*

/ server.js
// Main server file supporting TCGdex API

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

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Increased limit for form data

// Serve static files from frontend folder (one level up from backend)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Mount routes
// No JustTCG routes needed

// AI Card Identification endpoint (for Gemini AI)
app.post('/api/cards/identify-image', async (req, res) => {
  try {
    const { base64Image, language } = req.body;

    if (!base64Image) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    // Use your existing Gemini service
    const cardData = await identifyCardFromBase64(base64Image, language || 'en');

    res.json({
      success: true,
      card: {
        name: cardData.name,
        set: cardData.set,
        setNumber: cardData.setNumber,
        rarity: cardData.rarity,
        language: cardData.language,
        confidence: 1.0
      }
    });

  } catch (error) {
    console.error('Error identifying card:', error);
    res.status(500).json({ 
      error: 'AI identification failed',
      details: error.message 
    });
  }
});

// Shared authentication endpoint (used by both)
app.post('/api/login', async (req, res) => {
  console.log('Login attempt received:', req.body); // Debug log
  try {
    const { email, password } = req.body;

    console.log('Checking credentials...'); // Debug log
    console.log('ENV Email:', process.env.ADMIN_EMAIL);
    console.log('ENV Pass exists:', !!process.env.ADMIN_PASS);

    // TODO: Replace with your actual authentication logic
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASS) {
      // Generate token (use JWT in production)
      const token = 'demo-token-' + Date.now();
      
      console.log('Login successful!'); // Debug log
      res.json({
        success: true,
        token: token,
        message: 'Login successful'
      });
    } else {
      console.log('Invalid credentials'); // Debug log
      res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// Shared inventory endpoint (used by both APIs)
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
      source: card.source || 'unknown'
    };

    // Save to Supabase
    const savedItem = await supabaseInventory.addCard(inventoryItem);

    res.json({
      success: true,
      message: 'Card added to inventory successfully',
      item: savedItem
    });

  } catch (error) {
    console.error('Error adding to inventory:', error);
    res.status(500).json({ 
      error: 'Failed to add card to inventory',
      details: error.message 
    });
  }
});

// Get inventory count for a specific card
app.get('/api/inventory/count', async (req, res) => {
  try {
    const { cardName, setName, cardNumber } = req.query;

    if (!cardName) {
      return res.status(400).json({ error: 'Card name is required' });
    }

    const count = await supabaseInventory.getCardCount(cardName, setName, cardNumber);

    res.json({
      success: true,
      cardName: cardName,
      setName: setName,
      cardNumber: cardNumber,
      count: count
    });

  } catch (error) {
    console.error('Error getting inventory count:', error);
    res.status(500).json({ 
      error: 'Failed to get inventory count',
      details: error.message 
    });
  }
});

// Get all inventory items
app.get('/api/inventory', async (req, res) => {
  try {
    const filters = {
      cardName: req.query.cardName,
      setName: req.query.setName,
      language: req.query.language,
      condition: req.query.condition,
      source: req.query.source
    };

    // Remove undefined filters
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined) delete filters[key];
    });

    const items = Object.keys(filters).length > 0 
      ? await supabaseInventory.getItems(filters)
      : await supabaseInventory.getAllItems();

    res.json({
      success: true,
      items: items,
      count: items.length
    });

  } catch (error) {
    console.error('Error getting inventory:', error);
    res.status(500).json({ 
      error: 'Failed to get inventory',
      details: error.message 
    });
  }
});

// Get inventory statistics
app.get('/api/inventory/stats', async (req, res) => {
  try {
    const stats = await supabaseInventory.getStats();
    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    console.error('Error getting inventory stats:', error);
    res.status(500).json({ 
      error: 'Failed to get inventory stats',
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apis: {
      tcgdex: 'active'
    },
    timestamp: new Date().toISOString()
  });
});

// Route to serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')); // TCGdex page
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
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
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
  ║   Card Upload (TCGdex):  http://localhost:${PORT}         ║
  ║                                                           ║
  ║   API Status: http://localhost:${PORT}/api/health         ║
  ║   Inventory Stats: http://localhost:${PORT}/api/inventory/stats  ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `);
});


*/

// server.js
// Main server file supporting TCGdex API

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


// Uncomment when you set up Google Sheets:
import { searchCardsInSheet, getAllCardsFromSheet } from './services/google-sheets-service.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Increased limit for form data

// Serve static files from frontend folder (one level up from backend)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Mount routes
// No JustTCG routes needed

// Google Sheets + TCGdex hybrid search endpoint
app.get('/api/cards/search-sheet', async (req, res) => {
  try {
    const { name, set, limit } = req.query;

    if (!name) {
      return res.status(400).json({ error: 'Card name is required' });
    }

    let cards = [];
    let source = '';

    // Try Google Sheets first
    try {
      // Uncomment when Google Sheets is set up:
       cards = await searchCardsInSheet(name, parseInt(limit) || 100);
      
      if (cards && cards.length > 0) {
        source = 'google-sheet';
        console.log(`✅ Using Google Sheets results (${cards.length} cards)`);
      }
    } catch (sheetError) {
      console.log('Google Sheets failed, will try TCGdex:', sheetError.message);
    }

    // If Google Sheets returned nothing or failed, try TCGdex
    if (!cards || cards.length === 0) {
      console.log('⚠️ No results from Google Sheets, falling back to TCGdex');
      source = 'tcgdex-fallback';
      // Return empty to let frontend use TCGdex directly
      return res.json({
        success: true,
        cards: [],
        count: 0,
        source: source,
        useTCGdex: true // Signal to frontend to use TCGdex
      });
    }

    res.json({
      success: true,
      cards: cards,
      count: cards.length,
      source: source
    });

  } catch (error) {
    console.error('Error in hybrid search:', error);
    // On error, signal to use TCGdex
    res.json({
      success: true,
      cards: [],
      count: 0,
      source: 'error',
      useTCGdex: true
    });
  }
});

// AI Card Identification endpoint (for Gemini AI)
app.post('/api/cards/identify-image', async (req, res) => {
  try {
    const { base64Image, language } = req.body;

    if (!base64Image) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    // Use your existing Gemini service
    const cardData = await identifyCardFromBase64(base64Image, language || 'en');

    res.json({
      success: true,
      card: {
        name: cardData.name,
        set: cardData.set,
        setNumber: cardData.setNumber,
        rarity: cardData.rarity,
        language: cardData.language,
        confidence: 1.0
      }
    });

  } catch (error) {
    console.error('Error identifying card:', error);
    res.status(500).json({ 
      error: 'AI identification failed',
      details: error.message 
    });
  }
});

// Shared authentication endpoint (used by both)
app.post('/api/login', async (req, res) => {
  console.log('Login attempt received:', req.body); // Debug log
  try {
    const { email, password } = req.body;

    console.log('Checking credentials...'); // Debug log
    console.log('ENV Email:', process.env.ADMIN_EMAIL);
    console.log('ENV Pass exists:', !!process.env.ADMIN_PASS);

    // TODO: Replace with your actual authentication logic
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASS) {
      // Generate token (use JWT in production)
      const token = 'demo-token-' + Date.now();
      
      console.log('Login successful!'); // Debug log
      res.json({
        success: true,
        token: token,
        message: 'Login successful'
      });
    } else {
      console.log('Invalid credentials'); // Debug log
      res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// Shared inventory endpoint (used by both APIs)
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
      source: card.source || 'unknown'
    };

    // Save to Supabase
    const savedItem = await supabaseInventory.addCard(inventoryItem);

    res.json({
      success: true,
      message: 'Card added to inventory successfully',
      item: savedItem
    });

  } catch (error) {
    console.error('Error adding to inventory:', error);
    res.status(500).json({ 
      error: 'Failed to add card to inventory',
      details: error.message 
    });
  }
});

// Get inventory count for a specific card
app.get('/api/inventory/count', async (req, res) => {
  try {
    const { cardName, setName, cardNumber } = req.query;

    if (!cardName) {
      return res.status(400).json({ error: 'Card name is required' });
    }

    const count = await supabaseInventory.getCardCount(cardName, setName, cardNumber);

    res.json({
      success: true,
      cardName: cardName,
      setName: setName,
      cardNumber: cardNumber,
      count: count
    });

  } catch (error) {
    console.error('Error getting inventory count:', error);
    res.status(500).json({ 
      error: 'Failed to get inventory count',
      details: error.message 
    });
  }
});

// Get all inventory items
app.get('/api/inventory', async (req, res) => {
  try {
    const filters = {
      cardName: req.query.cardName,
      setName: req.query.setName,
      language: req.query.language,
      condition: req.query.condition,
      source: req.query.source
    };

    // Remove undefined filters
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined) delete filters[key];
    });

    const items = Object.keys(filters).length > 0 
      ? await supabaseInventory.getItems(filters)
      : await supabaseInventory.getAllItems();

    res.json({
      success: true,
      items: items,
      count: items.length
    });

  } catch (error) {
    console.error('Error getting inventory:', error);
    res.status(500).json({ 
      error: 'Failed to get inventory',
      details: error.message 
    });
  }
});

// Get inventory statistics
app.get('/api/inventory/stats', async (req, res) => {
  try {
    const stats = await supabaseInventory.getStats();
    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    console.error('Error getting inventory stats:', error);
    res.status(500).json({ 
      error: 'Failed to get inventory stats',
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apis: {
      tcgdex: 'active'
    },
    timestamp: new Date().toISOString()
  });
});

// Route to serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')); // TCGdex page
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
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
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
  ║   Card Upload (TCGdex):  http://localhost:${PORT}         ║
  ║                                                           ║
  ║   API Status: http://localhost:${PORT}/api/health         ║
  ║   Inventory Stats: http://localhost:${PORT}/api/inventory/stats  ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `);
});
