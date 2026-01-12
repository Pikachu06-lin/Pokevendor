// services/justtcg-service.js
// JustTCG API Integration Service - ES Module Version

const JUSTTCG_API_KEY = process.env.JUSTTCG_API_KEY;
const JUSTTCG_BASE_URL = 'https://api.justtcg.com/v1';

// Debug logging
console.log('JustTCG API Key loaded:', !!JUSTTCG_API_KEY);
console.log('JustTCG API Key first 10 chars:', JUSTTCG_API_KEY?.substring(0, 10));

/**
 * Format a single card object from JustTCG
 * Handles the nested variants structure
 * @param {Object} card - JustTCG card object
 * @param {Object} variant - Optional specific variant
 * @returns {Object|Array} Formatted card object or array of card objects
 */
function formatJustTCGCard(card, variant = null) {
  // If a specific variant is provided, format just that one
  if (variant) {
    return {
      id: variant.id || card.id,
      name: card.name,
      set_name: card.set_name,
      set_id: card.set?.id,
      number: card.number,
      rarity: card.rarity,
      printing: variant.printing,
      condition: variant.condition,
      language: variant.language,
      price: variant.price || 0, // Price in dollars
      image_url: card.image_url || null,
      tcgplayer_id: variant.tcgplayerSkuId,
      game: card.game,
      source: 'justtcg',
      price_history: variant.priceHistory,
      last_updated: variant.lastUpdated
    };
  }
  
  // If card has variants, return array of formatted variants
  if (card.variants && Array.isArray(card.variants) && card.variants.length > 0) {
    return card.variants.map(v => formatJustTCGCard(card, v));
  }
  
  // Fallback: format card without variant data
  return {
    id: card.id,
    name: card.name,
    set_name: card.set_name,
    set_id: card.set?.id,
    number: card.number,
    rarity: card.rarity,
    printing: null,
    condition: null,
    language: null,
    price: 0,
    image_url: card.image_url || null,
    tcgplayer_id: card.tcgplayerId,
    game: card.game,
    source: 'justtcg',
    price_history: null,
    last_updated: null
  };
}

/**
 * Format multiple cards from JustTCG
 * Flattens variants into separate card entries
 * @param {Array} cards - Array of JustTCG card objects
 * @param {string} languageFilter - Optional language filter (e.g., 'Japanese')
 * @returns {Array} Array of formatted card objects
 */
function formatJustTCGCards(cards, languageFilter = null) {
  const formatted = [];
  
  cards.forEach(card => {
    const result = formatJustTCGCard(card);
    
    // If formatJustTCGCard returned an array (has variants), flatten it
    if (Array.isArray(result)) {
      formatted.push(...result);
    } else {
      formatted.push(result);
    }
  });
  
  // Filter by language if specified
  if (languageFilter) {
    return formatted.filter(card => 
      card.language && card.language.toLowerCase() === languageFilter.toLowerCase()
    );
  }
  
  return formatted;
}

/**
 * Search for Pokemon cards using JustTCG API
 * @param {string} query - Card name or search term
 * @param {string} language - Language code (en, ja, etc.)
 * @param {string} condition - Card condition
 * @param {number} limit - Number of results to return
 * @returns {Promise<Array>} Array of card objects
 */
export async function searchJustTCGCards(query, language = 'ja', condition = null, limit = 20) {
  try {
    const params = new URLSearchParams({
      game: 'pokemon',
      q: query,
      limit: limit.toString()
    });

    if (condition) {
      params.append('condition', condition);
    }

    const url = `${JUSTTCG_BASE_URL}/cards?${params.toString()}`;

    console.log('=== searchJustTCGCards Request ===');
    console.log('URL:', url);
    console.log('Query:', query);
    console.log('================================');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': JUSTTCG_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response body:', errorText);
      throw new Error(`JustTCG API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Success! Found', data.data?.length || 0, 'cards');
    
    return formatJustTCGCards(data.data || [], language === 'ja' ? 'Japanese' : null);
  } catch (error) {
    console.error('Error searching JustTCG:', error);
    throw error;
  }
}

/**
 * Search Japanese Pokemon cards specifically
 * @param {string} query - Card name in Japanese or English
 * @param {number} limit - Number of results
 * @returns {Promise<Array>} Array of Japanese cards
 */
export async function searchJapaneseCards(query, limit = 20) {
  try {
    const params = new URLSearchParams({
      game: 'pokemon',
      q: query,
      limit: limit.toString()
    });

    const url = `${JUSTTCG_BASE_URL}/cards?${params.toString()}`;
    
    console.log('=== searchJapaneseCards Request ===');
    console.log('URL:', url);
    console.log('Query:', query);
    console.log('API Key (first 10):', JUSTTCG_API_KEY?.substring(0, 10));
    console.log('===================================');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': JUSTTCG_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response body:', errorText);
      console.error('Error response headers:', Object.fromEntries(response.headers.entries()));
      throw new Error(`JustTCG API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Success! Response data structure:', {
      hasData: !!data.data,
      dataLength: data.data?.length || 0,
      keys: Object.keys(data)
    });
    
    const allCards = data.data || [];
    console.log('Raw cards from API:', allCards.length);
    
    // Log first card for debugging - FULL CARD OBJECT
    if (allCards.length > 0) {
      console.log('=== FULL RAW CARD DATA ===');
      console.log('First card (raw):', JSON.stringify(allCards[0], null, 2));
      console.log('All keys in first card:', Object.keys(allCards[0]));
      console.log('========================');
    }

    // Format and filter for Japanese language
    let formattedCards = formatJustTCGCards(allCards, 'Japanese');
    console.log('After filtering for Japanese:', formattedCards.length, 'variants');
    
    // If no Japanese cards found, return all variants as fallback
    if (formattedCards.length === 0) {
      console.log('No Japanese variants found, returning all variants');
      formattedCards = formatJustTCGCards(allCards, null);
      console.log('Total variants available:', formattedCards.length);
    }
    
    if (formattedCards.length > 0) {
      console.log('Sample card:', {
        name: formattedCards[0].name,
        language: formattedCards[0].language,
        price: formattedCards[0].price,
        condition: formattedCards[0].condition
      });
    }

    return formattedCards;
  } catch (error) {
    console.error('Error searching Japanese cards:', error);
    throw error;
  }
}

/**
 * Get card by specific ID
 * @param {string} cardId - JustTCG card ID
 * @param {string} condition - Card condition
 * @param {string} printing - Printing type
 * @returns {Promise<Object>} Card object
 */
export async function getJustTCGCardById(cardId, condition = null, printing = null) {
  try {
    const params = new URLSearchParams({
      cardId: cardId
    });

    if (condition) params.append('condition', condition);
    if (printing) params.append('printing', printing);

    const url = `${JUSTTCG_BASE_URL}/cards?${params.toString()}`;

    console.log('=== getJustTCGCardById Request ===');
    console.log('URL:', url);
    console.log('Card ID:', cardId);
    console.log('==================================');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': JUSTTCG_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response body:', errorText);
      throw new Error(`JustTCG API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const cards = data.data || [];
    
    console.log('Found', cards.length, 'cards for ID:', cardId);
    
    return cards.length > 0 ? formatJustTCGCard(cards[0]) : null;
  } catch (error) {
    console.error('Error getting card by ID:', error);
    throw error;
  }
}

/**
 * Get all available Pokemon sets from JustTCG
 * @returns {Promise<Array>} Array of set objects
 */
export async function getJustTCGPokemonSets() {
  try {
    const url = `${JUSTTCG_BASE_URL}/sets?game=pokemon`;

    console.log('=== getJustTCGPokemonSets Request ===');
    console.log('URL:', url);
    console.log('====================================');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': JUSTTCG_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response body:', errorText);
      throw new Error(`JustTCG API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Found', data.data?.length || 0, 'sets');
    
    return data.data || [];
  } catch (error) {
    console.error('Error getting Pokemon sets:', error);
    throw error;
  }
}

/**
 * Get API usage statistics
 * @returns {Promise<Object>} API usage data
 */
export async function getJustTCGApiUsage() {
  try {
    const url = `${JUSTTCG_BASE_URL}/cards?game=pokemon&limit=1`;

    console.log('=== getJustTCGApiUsage Request ===');
    console.log('URL:', url);
    console.log('==================================');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': JUSTTCG_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response body:', errorText);
      throw new Error(`JustTCG API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('API usage data:', data._metadata || {});
    
    return data._metadata || {};
  } catch (error) {
    console.error('Error getting API usage:', error);
    throw error;
  }
}