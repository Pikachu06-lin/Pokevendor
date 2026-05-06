// services/tcgapi-service.js
// Replaces supabase-catalog-service.js — uses tcgapi.dev for card lookups

const TCGAPI_BASE = 'https://api.tcgapi.dev/v1';
const TCGAPI_KEY = process.env.TCGAPI_KEY;

/**
 * Searches tcgapi.dev for a Pokemon card by name.
 * Tries multiple query strategies before giving up.
 *
 * @param {string} cardName     - English card name from Gemini (e.g. "Lillie's Clefairy ex")
 * @param {string} setName      - Set name from Gemini (optional)
 * @param {string} cardNumber   - Card number from Gemini (e.g. "126/102", optional)
 * @param {string} cardLanguage - Language of the physical card ("Japanese", "English", etc.)
 * @param {number} limit        - Max results to return (default 20)
 * @returns {Promise<Array>}    - Array of matched card objects
 */
export async function searchCardInTCGAPI(
  cardName,
  setName = '',
  cardNumber = '',
  cardLanguage = 'English',
  limit = 20
) {
  if (!cardName) throw new Error('Card name is required');
  if (!TCGAPI_KEY) throw new Error('TCGAPI_KEY is not set in environment variables');

  const isJapanese = isJapaneseCard(cardLanguage);

  // Japanese cards use a dedicated game slug on tcgapi.dev — search it directly
  // instead of filtering the English catalog. English name is stored in inventory
  // but prices come from the pokemon-japan game.
  const game    = isJapanese ? 'pokemon-japan' : 'pokemon';
  const queries = buildQueryStrategies(cardName);

  let results = [];

  for (const query of queries) {
    console.log(`🔍 TCG API [${game}] "${query}" | set: "${setName}" | #${cardNumber}`);
    results = await fetchSearch(query, game);

    if (results.length > 0) {
      console.log(`✅ Got ${results.length} results`);
      break;
    }

    console.log(`⚠️  No results for "${query}", trying next strategy...`);
  }

  if (results.length === 0) {
    console.log(`❌ All strategies exhausted for "${cardName}"`);
    return [];
  }

  const ranked = rankResults(results, { cardName, setName, cardNumber, isJapanese });

  // Debug: top results with scores
  console.log('📊 Top ranked results:');
  ranked.slice(0, 6).forEach((c, i) => {
    console.log(`  ${i + 1}. [score:${c._score}] "${c.name}" | set: "${c.set_name}" | #${c.number}`);
  });

  return ranked.slice(0, limit).map(formatCard);
}

// ---------------------------------------------------------------------------
// Query strategies
// ---------------------------------------------------------------------------

/**
 * Returns an ordered array of search queries to try, from most specific to most general.
 * Handles trainer-named cards (e.g. "Lillie's Clefairy ex") and special characters.
 *
 * Examples:
 *   "Lillie's Clefairy ex"  → ["Lillie's Clefairy ex", "Lillies Clefairy ex", "Clefairy ex", "Clefairy"]
 *   "Pikachu VMAX"          → ["Pikachu VMAX", "Pikachu"]
 *   "Charizard ex"          → ["Charizard ex", "Charizard"]
 */
function buildQueryStrategies(cardName) {
  const queries = new Set();

  // 1. Original name as-is
  queries.add(cardName.trim());

  // 2. Strip apostrophes/special chars (Lillie's → Lillies)
  const stripped = cardName.replace(/['''\u2019`]/g, '').trim();
  if (stripped !== cardName.trim()) queries.add(stripped);

  // 3. If it's a trainer-named card ("X's Y" or "X's Y suffix"), try just the Pokemon part
  //    Matches: "Lillie's Clefairy ex", "Brock's Onix", "Misty's Psyduck VMAX"
  const trainerPattern = /^.+?['''\u2019]s\s+(.+)$/i;
  const trainerMatch = cardName.match(trainerPattern);
  if (trainerMatch) {
    const pokemonPart = trainerMatch[1].trim(); // e.g. "Clefairy ex"
    queries.add(pokemonPart);

    // Also try without suffix (e.g. "Clefairy")
    const withoutSuffix = removeSuffix(pokemonPart);
    if (withoutSuffix !== pokemonPart) queries.add(withoutSuffix);
  }

  // 4. Remove card suffixes (ex, EX, GX, V, VMAX, VSTAR) and try bare name
  const withoutSuffix = removeSuffix(cardName);
  if (withoutSuffix !== cardName.trim()) queries.add(withoutSuffix);

  // 5. First word only as last resort (e.g. "Lillie" or "Charizard")
  const firstWord = cardName.split(/\s+/)[0].replace(/['''\u2019`]/g, '');
  if (firstWord.length > 2) queries.add(firstWord);

  return Array.from(queries);
}


/**
 * Strips the trainer prefix from a card name, returning just the Pokemon part.
 * "Cynthias Garchomp ex" -> "Garchomp ex"
 * "Pikachu VMAX"         -> "Pikachu VMAX" (unchanged)
 */
function extractPokemonName(cardName) {
  const trainerMatch = cardName.match(/^.+?['u2019]s\s+(.+)$/i);
  return trainerMatch ? trainerMatch[1].trim() : cardName.trim();
}

function removeSuffix(name) {
  return name
    .replace(/\s+(ex|EX|GX|V|VMAX|VSTAR|V-UNION|LEGEND|Prime|LV\.X|Break|BREAK|Tag\s*Team)$/i, '')
    .trim();
}

// ---------------------------------------------------------------------------
// API fetch
// ---------------------------------------------------------------------------

async function fetchSearch(query, game = 'pokemon') {
  const params = new URLSearchParams({
    q: query,
    game,
    type: 'Cards',
    per_page: 100,
  });

  const url = `${TCGAPI_BASE}/search?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      'X-API-Key': TCGAPI_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`TCG API error ${response.status}: ${errText}`);
  }

  const json = await response.json();
  return json.data || [];
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function rankResults(results, { cardName, setName, cardNumber, isJapanese }) {
  const normalizedCardName = normalize(cardName);
  const normalizedSetName  = normalize(setName);
  const normalizedNumber   = normalizeNumber(cardNumber);

  // Sequence number before "/" (e.g. "126" from "126/102").
  // JP sets sometimes have a different total than what Gemini reads,
  // so matching just the sequence number is a strong-enough signal.
  const cardSeqNum = cardNumber ? normalizedNumber.split('/')[0].trim() : '';

  // Extract Pokemon name from trainer-named cards for matching
  const trainerMatch = cardName.match(/^.+?[’'\u0027]s\s+(.+)$/i);
  const pokemonCoreName = trainerMatch
    ? normalize(removeSuffix(trainerMatch[1]))
    : normalizedCardName;

  return results
    .map((card) => {
      let score = 0;
      const resultName   = normalize(card.name || '');
      const resultSet    = normalize(card.set_name || '');
      const resultNumber = normalizeNumber(card.number || '');
      const resultSeqNum = resultNumber ? resultNumber.split('/')[0].trim() : '';

      // --- Name matching ---
      if (resultName === normalizedCardName) score += 60;
      else if (resultName.includes(normalizedCardName) || normalizedCardName.includes(resultName)) score += 30;
      else if (resultName.includes(pokemonCoreName) || pokemonCoreName.includes(resultName)) score += 20;

      // --- Set name match ---
      // Words from Gemini's set name that are meaningful (>3 chars)
      const setWords     = normalizedSetName ? normalizedSetName.split(' ').filter(w => w.length > 3) : [];
      const matchedWords = setWords.filter(w => resultSet.includes(w));

      if (normalizedSetName) {
        if (resultSet.includes(normalizedSetName)) score += 40;        // full set name found
        else if (normalizedSetName.includes(resultSet)) score += 25;   // result set is substring
        else if (matchedWords.length > 0) {
          score += matchedWords.length * 12;                            // partial word overlap
          if (matchedWords.length === setWords.length) score += 20;    // all words matched
        } else if (setWords.length > 0) {
          // ZERO set words matched — this result is almost certainly the wrong set.
          // Apply a penalty so a pure card-number hit can't override a correct set match.
          score -= 60;
        }
      }

      // --- Card number match ---
      // Cap number bonuses when the set is a confirmed mismatch (matchedWords === 0 and we have
      // a setName to compare against), so correct-set results always outrank same-number
      // results from the wrong set.
      const setMismatch = setWords.length > 0 && matchedWords.length === 0;

      if (normalizedNumber && resultNumber && resultNumber === normalizedNumber) {
        score += setMismatch ? 30 : 80; // exact full match (reduced when set is wrong)
      } else if (cardSeqNum && resultSeqNum && cardSeqNum === resultSeqNum) {
        score += setMismatch ? 15 : 50; // same sequence number
      } else if (normalizedNumber && resultNumber &&
                 (resultNumber.startsWith(normalizedNumber) || normalizedNumber.startsWith(resultNumber))) {
        score += setMismatch ? 5 : 20;  // loose prefix match
      }

      // --- Has a price ---
      if (card.market_price) score += 10;

      return { ...card, _score: score };
    })
    .sort((a, b) => b._score - a._score);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatCard(card) {
  return {
    id:             card.id,
    name:           card.name,
    number:         card.number          || '',
    rarity:         card.rarity          || '',
    set:            card.set_name        || '',
    marketPrice:    card.market_price    ?? null,
    lowPrice:       card.low_price       ?? null,
    medianPrice:    card.median_price    ?? null,
    foilPrice:      card.foil_only ? card.market_price : null,
    printing:       card.printing        || 'Normal',
    totalListings:  card.total_listings  ?? 0,
    imageUrl:       card.image_url       || '',
    source:         'tcgapi',
    game:           card.game_name       || 'Pokemon',
    tcgplayerId:    card.tcgplayer_id    || null,
    priceUpdatedAt: card.price_updated_at || null,
    _score:         card._score,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isJapaneseCard(language) {
  return (language || '').toLowerCase().includes('japan');
}

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/['''\u2019`]/g, '')    // strip apostrophes (curly + straight)
    .replace(/[^a-z0-9\s]/g, '')    // strip other special chars
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNumber(num) {
  return (num || '').trim().replace(/^0+(\d)/, '$1');
}