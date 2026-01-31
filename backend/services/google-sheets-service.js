// services/google-sheets-service.js
// Google Sheets service for reading Pokemon card data with keyword matching

import { google } from 'googleapis';

// Google Sheets configuration
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "accounting - pokevendor REAL"; // Name of your sheet tab
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

/**
 * Search for cards in Google Sheets by name with keyword/alias matching
 * @param {string} cardName - Name of the card to search for
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} Array of matching cards
 */
export async function searchCardsInSheet(cardName, limit = 100) {
  try {
    if (!SPREADSHEET_ID || !API_KEY) {
      console.log('Google Sheets not configured, skipping...');
      return [];
    }

    const sheets = google.sheets({ version: 'v4', auth: API_KEY });

    // Read all data from the sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "master_catalog!B:F", // Original columns: sku, card_name, set, rarity, price, image_url
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      console.log('No data found in Google Sheet');
      return [];
    }

    // First row is headers
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const data = rows.slice(1);

    // Map rows to card objects
    const cards = data.map(row => {
      const card = {};
      headers.forEach((header, index) => {
        card[header] = row[index] || '';
      });
      return card;
    });

    // Create comprehensive name variations for better matching
    const nameLower = cardName.toLowerCase().trim();
    const nameVariations = createNameVariations(nameLower);
    
    console.log(`🔍 Searching for: "${cardName}"`);
    console.log(`📝 Generated ${nameVariations.length} variations:`, nameVariations.slice(0, 5));
    
    // Filter by card name AND keywords/aliases
    let matchingCards = cards.filter(card => {
      return matchesCard(card, nameVariations);
    });

    // Format cards to match expected structure
    const formattedCards = matchingCards.slice(0, limit).map(card => formatSheetCard(card));

    console.log(`✅ Found ${formattedCards.length} cards in Google Sheet for "${cardName}"`);
    
    if (formattedCards.length > 0) {
      console.log(`📋 Top matches:`, formattedCards.slice(0, 3).map(c => c.name));
    }

    return formattedCards;

  } catch (error) {
    console.error('Error reading from Google Sheets:', error);
    // Return empty array on error so we can fall back to TCGdex
    return [];
  }
}

/**
 * Create comprehensive name variations for matching
 * @param {string} name - Original card name
 * @returns {Array<string>} Array of name variations
 */
function createNameVariations(name) {
  const variations = new Set();
  
  // Original name
  variations.add(name);
  
  // Remove/replace special characters
  variations.add(name.replace(/&/g, '＆'));
  variations.add(name.replace(/&/g, 'and'));
  variations.add(name.replace(/&/g, ' '));
  variations.add(name.replace(/[&＆]/g, ''));
  
  // Remove spaces
  variations.add(name.replace(/\s+/g, ''));
  
  // Handle possessives (Lillie's -> Lillie, Lillies)
  variations.add(name.replace(/'s\s/g, ' '));
  variations.add(name.replace(/'s/g, ''));
  variations.add(name.replace(/'/g, ''));
  
  // Handle hyphens and dashes
  variations.add(name.replace(/-/g, ' '));
  variations.add(name.replace(/-/g, ''));
  variations.add(name.replace(/\s+/g, '-'));
  
  // Normalize unicode characters (important for Japanese)
  variations.add(name.normalize('NFKC'));
  variations.add(name.normalize('NFD'));
  
  // Remove common words that might cause issues
  const withoutCommonWords = name
    .replace(/\b(the|a|an|of|and)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutCommonWords) {
    variations.add(withoutCommonWords);
  }
  
  return Array.from(variations).filter(v => v.length > 0);
}

/**
 * Check if a card matches any of the name variations
 * Uses partial matching to find cards by character name or key terms
 * @param {Object} card - Card from Google Sheets
 * @param {Array<string>} nameVariations - Array of name variations to match
 * @returns {boolean} True if card matches
 */
function matchesCard(card, nameVariations) {
  const cardNameInSheet = (card.name || card.card_name || '').toLowerCase().trim();
  const keywordsStr = (card.keywords || card.aliases || '').toLowerCase().trim();
  
  // Split keywords by comma or semicolon
  const keywordsList = keywordsStr
    .split(/[,;]/)
    .map(k => k.trim())
    .filter(k => k.length > 0);
  
  // Extract key terms from the search query (character names, important words)
  const searchTerms = extractKeyTerms(nameVariations);
  
  // Check if card name contains any of the key terms
  const matchesCardName = searchTerms.some(term => {
    return cardNameInSheet.includes(term) || term.includes(cardNameInSheet);
  });
  
  if (matchesCardName) {
    return true;
  }
  
  // Check if any keyword/alias contains any of the key terms
  const matchesKeyword = keywordsList.some(keyword => {
    return searchTerms.some(term => {
      return keyword.includes(term) || term.includes(keyword);
    });
  });
  
  return matchesKeyword;
}

/**
 * Extract key search terms from name variations
 * Focuses on important words like character names
 * @param {Array<string>} variations - Name variations
 * @returns {Array<string>} Key search terms
 */
function extractKeyTerms(variations) {
  const terms = new Set();
  
  // Common words to ignore (stop words)
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
    'can', 'could', 'may', 'might', 'must', 'shall',
    // Pokemon-specific stop words
    'determination', 'resolve', 'orders', 'command', 'full', 'force',
    'supporter', 'trainer', 'item', 'stadium', 'energy', 'gx', 'ex', 'v', 'vmax', 'vstar'
  ]);
  
  variations.forEach(variation => {
    // Split into words
    const words = variation.split(/[\s-_']+/);
    
    words.forEach(word => {
      // Only keep words that are:
      // 1. At least 3 characters long (captures character names)
      // 2. Not in the stop words list
      if (word.length >= 3 && !stopWords.has(word)) {
        terms.add(word);
      }
    });
    
    // Also add the full variation for exact matching
    if (variation.length >= 3) {
      terms.add(variation);
    }
  });
  
  return Array.from(terms);
}

/**
 * Get all cards from Google Sheet
 * @returns {Promise<Array>} All cards
 */
export async function getAllCardsFromSheet() {
  try {
    const sheets = google.sheets({ version: 'v4', auth: API_KEY });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "master_catalog!B:F", // Original columns only
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return [];

    const headers = rows[0].map(h => h.toLowerCase().trim());
    const data = rows.slice(1);

    const cards = data.map(row => {
      const card = {};
      headers.forEach((header, index) => {
        card[header] = row[index] || '';
      });
      return formatSheetCard(card);
    });

    return cards;

  } catch (error) {
    console.error('Error reading all cards from Google Sheets:', error);
    throw error;
  }
}

/**
 * Format a card from Google Sheets to match TCGdex structure
 * @param {Object} sheetCard - Card data from Google Sheets
 * @returns {Object} Formatted card
 */
function formatSheetCard(sheetCard) {
  // Your sheet columns: sku, card_name, set, rarity, price, image_url
  
  return {
    id: sheetCard.sku || generateId(sheetCard),
    name: sheetCard.card_name || sheetCard.name || 'Unknown',
    localId: sheetCard.sku || sheetCard.card_number || '',
    set: {
      name: sheetCard.set || sheetCard.set_name || 'Unknown Set',
      id: (sheetCard.set || '').toLowerCase().replace(/\s+/g, '-')
    },
    rarity: sheetCard.rarity || 'Common',
    image: {
      small: sheetCard.image_url || sheetCard.image || '',
      high: sheetCard.image_url || sheetCard.image || ''
    },
    pricing: {
      tcgplayer: {
        normal: {
          marketPrice: parseFloat(sheetCard.price || 0)
        }
      }
    },
    // Additional fields
    language: sheetCard.language || 'JP',
    sku: sheetCard.sku || '',
    source: 'google-sheet'
  };
}

/**
 * Generate a unique ID for a card
 * @param {Object} card - Card data
 * @returns {string} Generated ID
 */
function generateId(card) {
  const name = (card.card_name || card.name || 'unknown').toLowerCase().replace(/\s+/g, '-');
  const set = (card.set || card.set_name || 'unknown').toLowerCase().replace(/\s+/g, '-');
  return `${set}-${name}`;
}

/**
 * Add a new card to Google Sheets
 * @param {Object} cardData - Card data to add
 * @returns {Promise<Object>} Added card
 */
export async function addCardToSheet(cardData) {
  try {
    // Note: This requires OAuth authentication, not just API key
    // You'll need to set up service account credentials for write access
    throw new Error('Adding cards to Google Sheets requires OAuth setup. Contact admin.');
  } catch (error) {
    console.error('Error adding to Google Sheets:', error);
    throw error;
  }
}