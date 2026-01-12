// routes/justtcg-routes.js
// Separate routes for JustTCG API - ES Module Version

import express from 'express';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { 
  searchJustTCGCards, 
  searchJapaneseCards, 
  getJustTCGCardById, 
  getJustTCGPokemonSets, 
  getJustTCGApiUsage 
} from '../services/justtcg-service.js';

const router = express.Router();

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * POST /api/justtcg/identify-card
 * Upload card image and identify using AI + JustTCG (for Japanese cards)
 */
router.post('/identify-card', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { cardName, language, condition } = req.body;

    // Use Gemini AI to identify the card from image
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const imageParts = [{
      inlineData: {
        data: req.file.buffer.toString('base64'),
        mimeType: req.file.mimetype
      }
    }];

    const prompt = `Analyze this Pokemon trading card image and provide:
1. The exact card name (in English and Japanese if visible)
2. The set name
3. The card number if visible
4. Whether it appears to be Japanese or English
5. Any special characteristics (holo, reverse holo, etc.)

Respond in JSON format:
{
  "cardName": "card name in English",
  "cardNameJapanese": "card name in Japanese if visible",
  "setName": "set name",
  "cardNumber": "number",
  "language": "japanese" or "english",
  "characteristics": "description"
}`;

    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const text = response.text();

    // Parse AI response
    let aiData;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      aiData = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (e) {
      console.error('Error parsing AI response:', e);
      aiData = { cardName: cardName || 'Unknown' };
    }

    // Search JustTCG with the identified card name
    const searchQuery = cardName || aiData.cardName || aiData.cardNameJapanese || 'Pokemon';
    
    let cards;
    if (language === 'ja' || aiData.language === 'japanese') {
      // Search for Japanese cards specifically - FIXED: Changed limit from 30 to 20
      cards = await searchJapaneseCards(searchQuery, 20);
    } else {
      // Search for cards with condition filter - FIXED: Changed limit from 30 to 20
      cards = await searchJustTCGCards(
        searchQuery, 
        language || 'en',
        condition,
        20
      );
    }

    // Filter and rank results based on AI identification
    let rankedCards = cards;
    
    if (aiData.setName) {
      rankedCards = cards.sort((a, b) => {
        const aSetMatch = a.set_name && a.set_name.toLowerCase().includes(aiData.setName.toLowerCase());
        const bSetMatch = b.set_name && b.set_name.toLowerCase().includes(aiData.setName.toLowerCase());
        
        if (aSetMatch && !bSetMatch) return -1;
        if (!aSetMatch && bSetMatch) return 1;
        
        return (b.price || 0) - (a.price || 0);
      });
    }

    res.json({
      success: true,
      source: 'justtcg',
      aiIdentification: aiData,
      cards: rankedCards.slice(0, 20),
      totalResults: rankedCards.length
    });

  } catch (error) {
    console.error('Error identifying card with JustTCG:', error);
    res.status(500).json({ 
      error: 'Failed to identify card',
      details: error.message 
    });
  }
});

/**
 * GET /api/justtcg/search-cards
 * Search cards by name using JustTCG
 */
router.get('/search-cards', async (req, res) => {
  try {
    const { query, language, condition, limit } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const cards = await searchJustTCGCards(
      query,
      language || 'en',
      condition,
      Math.min(parseInt(limit) || 20, 20) // Ensure limit doesn't exceed 20
    );

    res.json({
      success: true,
      source: 'justtcg',
      cards: cards,
      count: cards.length
    });

  } catch (error) {
    console.error('Error searching cards on JustTCG:', error);
    res.status(500).json({ 
      error: 'Failed to search cards',
      details: error.message 
    });
  }
});

/**
 * GET /api/justtcg/japanese-cards
 * Search Japanese Pokemon cards specifically
 */
router.get('/japanese-cards', async (req, res) => {
  try {
    const { query, limit } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const cards = await searchJapaneseCards(
      query,
      Math.min(parseInt(limit) || 20, 20) // Ensure limit doesn't exceed 20
    );

    res.json({
      success: true,
      source: 'justtcg',
      cards: cards,
      count: cards.length
    });

  } catch (error) {
    console.error('Error searching Japanese cards:', error);
    res.status(500).json({ 
      error: 'Failed to search Japanese cards',
      details: error.message 
    });
  }
});

/**
 * GET /api/justtcg/card/:id
 * Get specific card by ID from JustTCG
 */
router.get('/card/:id', async (req, res) => {
  try {
    const { condition, printing } = req.query;
    
    const card = await getJustTCGCardById(
      req.params.id,
      condition,
      printing
    );

    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json({
      success: true,
      source: 'justtcg',
      card: card
    });

  } catch (error) {
    console.error('Error getting card from JustTCG:', error);
    res.status(500).json({ 
      error: 'Failed to get card',
      details: error.message 
    });
  }
});

/**
 * GET /api/justtcg/sets
 * Get all Pokemon sets from JustTCG
 */
router.get('/sets', async (req, res) => {
  try {
    const sets = await getJustTCGPokemonSets();

    res.json({
      success: true,
      source: 'justtcg',
      sets: sets,
      count: sets.length
    });

  } catch (error) {
    console.error('Error getting sets from JustTCG:', error);
    res.status(500).json({ 
      error: 'Failed to get sets',
      details: error.message 
    });
  }
});

/**
 * GET /api/justtcg/usage
 * Get JustTCG API usage statistics
 */
router.get('/usage', async (req, res) => {
  try {
    const usage = await getJustTCGApiUsage();

    res.json({
      success: true,
      usage: usage
    });

  } catch (error) {
    console.error('Error getting JustTCG API usage:', error);
    res.status(500).json({ 
      error: 'Failed to get API usage',
      details: error.message 
    });
  }
});

// Default export
export default router;