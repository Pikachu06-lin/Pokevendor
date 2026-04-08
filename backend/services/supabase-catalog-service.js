// services/supabase-catalog-service.js
// Supabase service for reading Pokemon card catalog data

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('⚠️ Supabase credentials missing for catalog service!');
  console.error('Please set SUPABASE_URL and SUPABASE_KEY in your .env file');
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Supabase catalog service initialized');

/**
 * Search for cards in Supabase master_catalog by name
 * Uses character-based partial matching (like "Lillie" finds all Lillie cards)
 * @param {string} cardName - Name of the card to search for
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} Array of matching cards
 */
export async function searchCardsInCatalog(cardName, limit = 100) {
  try {
    if (!supabaseUrl || !supabaseKey) {
      console.log('Supabase not configured, skipping catalog search...');
      return [];
    }

    console.log(`🔍 Searching Supabase catalog for: "${cardName}"`);

    // Get all cards from master_catalog table
    const { data: cards, error } = await supabase
      .from('master_catalog')
      .select('*');

    if (error) {
      console.error('Supabase catalog query error:', error);
      return [];
    }

    if (!cards || cards.length === 0) {
      console.log('No data found in master_catalog table');
      return [];
    }

    // Create comprehensive name variations for better matching
    const nameLower = cardName.toLowerCase().trim();
    const nameVariations = createNameVariations(nameLower);
    
    console.log(`📝 Generated ${nameVariations.length} search variations`);
    
    // Filter by card name using partial matching
    let matchingCards = cards.filter(card => {
      return matchesCard(card, nameVariations);
    });

    // Format cards to match expected structure
    const formattedCards = matchingCards.slice(0, limit).map(card => formatCatalogCard(card));

    console.log(`✅ Found ${formattedCards.length} cards in Supabase catalog for "${cardName}"`);
    
    if (formattedCards.length > 0) {
      console.log(`📋 Top matches:`, formattedCards.slice(0, 3).map(c => c.name));
    }

    return formattedCards;

  } catch (error) {
    console.error('Error reading from Supabase catalog:', error);
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
 * @param {Object} card - Card from Supabase
 * @param {Array<string>} nameVariations - Array of name variations to match
 * @returns {boolean} True if card matches
 */
function matchesCard(card, nameVariations) {
  const cardNameInCatalog = (card.card_name || card.name || '').toLowerCase().trim();
  
  // Extract key terms from the search query (character names, important words)
  const searchTerms = extractKeyTerms(nameVariations);
  
  // Check if card name contains any of the key terms
  const matchesCardName = searchTerms.some(term => {
    return cardNameInCatalog.includes(term) || term.includes(cardNameInCatalog);
  });
  
  return matchesCardName;
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
 * Get all cards from Supabase catalog
 * @returns {Promise<Array>} All cards
 */
export async function getAllCardsFromCatalog() {
  try {
    const { data: cards, error } = await supabase
      .from('master_catalog')
      .select('*')
      .order('card_name', { ascending: true });

    if (error) {
      console.error('Supabase catalog query error:', error);
      throw error;
    }

    const formattedCards = (cards || []).map(card => formatCatalogCard(card));
    console.log(`✅ Retrieved ${formattedCards.length} cards from catalog`);
    
    return formattedCards;

  } catch (error) {
    console.error('Error reading all cards from Supabase catalog:', error);
    throw error;
  }
}

/**
 * Format a card from Supabase catalog to match TCGdex structure
 * @param {Object} catalogCard - Card data from Supabase
 * @returns {Object} Formatted card
 */
function formatCatalogCard(catalogCard) {
  // Catalog columns: sku, card_name, set, rarity, price, image_url
  
  return {
    id: catalogCard.sku || generateId(catalogCard),
    name: catalogCard.card_name || catalogCard.name || 'Unknown',
    localId: catalogCard.sku || catalogCard.card_number || '',
    set: {
      name: catalogCard.set || catalogCard.set_name || 'Unknown Set',
      id: (catalogCard.set || '').toLowerCase().replace(/\s+/g, '-')
    },
    rarity: catalogCard.rarity || 'Common',
    image: {
      small: catalogCard.image_url || catalogCard.image || '',
      high: catalogCard.image_url || catalogCard.image || ''
    },
    pricing: {
      tcgplayer: {
        normal: {
          marketPrice: parseFloat(catalogCard.price || 0)
        }
      }
    },
    // Additional fields
    language: catalogCard.language || 'JP',
    sku: catalogCard.sku || '',
    source: 'supabase-catalog'
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
 * Search cards by SKU
 * @param {string} sku - SKU to search for
 * @returns {Promise<Object|null>} Card or null
 */
export async function getCardBySKU(sku) {
  try {
    const { data, error } = await supabase
      .from('master_catalog')
      .select('*')
      .eq('sku', sku)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error('Error fetching card by SKU:', error);
      return null;
    }

    return formatCatalogCard(data);
  } catch (error) {
    console.error('Error in getCardBySKU:', error);
    return null;
  }
}

/**
 * Get cards by set name
 * @param {string} setName - Set name to filter by
 * @returns {Promise<Array>} Array of cards
 */
export async function getCardsBySet(setName) {
  try {
    const { data: cards, error } = await supabase
      .from('master_catalog')
      .select('*')
      .ilike('set', `%${setName}%`)
      .order('card_name', { ascending: true });

    if (error) {
      console.error('Error fetching cards by set:', error);
      return [];
    }

    return (cards || []).map(card => formatCatalogCard(card));
  } catch (error) {
    console.error('Error in getCardsBySet:', error);
    return [];
  }
}