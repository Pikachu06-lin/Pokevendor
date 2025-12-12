import axios from 'axios';

const API_BASE = 'https://api.pokemontcg.io/v2';
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

const instance = axios.create({
    baseURL: API_BASE,
    headers: { 'X-Api-Key': process.env.POKEMON_TCG_KEY || '' },
    timeout: 15000
});

/** === Dynamic data containers === */
let VALID_SUPERTYPES = [];
let VALID_TYPES = [];
let VALID_SUBTYPES = [];
let VALID_RARITIES = [];
let SET_ID_MAP = {};

/** === Fetch helper with retries === */
async function fetchWithRetry(url, config) {
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            console.log(`DEBUG: API Fetch Attempt ${i + 1} of ${MAX_RETRIES} => ${url}`);
            return await instance.get(url, config);
        } catch (err) {
            const status = err.response ? err.response.status : 'Network Error';
            if (i === MAX_RETRIES - 1 || (status !== 429 && status < 500 && status !== 'Network Error')) {
                throw err;
            }
            const delay = INITIAL_BACKOFF_MS * Math.pow(2, i) + Math.floor(Math.random() * 500);
            console.warn(`WARN: API Error (${status}). Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/** === Initialize dynamic validation data === */
export async function initPokemonTcgData() {
    try {
        // Supertypes
        const superResp = await fetchWithRetry('/supertypes');
        VALID_SUPERTYPES = superResp.data?.data || [];

        // Types
        const typesResp = await fetchWithRetry('/types');
        VALID_TYPES = typesResp.data?.data || [];

        // Subtypes
        const subResp = await fetchWithRetry('/subtypes');
        VALID_SUBTYPES = subResp.data?.data || [];

        // Rarities
        const rarResp = await fetchWithRetry('/rarities');
        VALID_RARITIES = rarResp.data?.data || [];

        // Sets
        const setsResp = await fetchWithRetry('/sets?pageSize=500'); // large pageSize to fetch all sets
        const sets = setsResp.data?.data || [];
        SET_ID_MAP = {};
        sets.forEach(s => {
            if (s.name) SET_ID_MAP[s.name] = s.id;
        });

        console.log('✅ Pokémon TCG validation data loaded');
    } catch (err) {
        console.error('Failed to initialize Pokémon TCG data:', err.message);
    }
}

/** === Normalization helpers === */
export function normalizeSupertype(value) {
    if (!value) return null;
    const clean = value.trim();
    return VALID_SUPERTYPES.includes(clean) ? clean : null;
}

export function normalizeType(value) {
    if (!value) return null;
    const clean = value.trim();
    return VALID_TYPES.includes(clean) ? clean : null;
}

export function normalizeSubtype(value) {
    if (!value) return null;
    const clean = value.trim();
    return VALID_SUBTYPES.includes(clean) ? clean : null;
}

export function normalizeRarity(value) {
    if (!value) return null;
    const clean = value.trim();
    return VALID_RARITIES.includes(clean) ? clean : null;
}

/** === Fetch card by ID === */
export async function fetchCardById(id) {
    if (!id) return null;
    try {
        const url = `/cards/${id}`;
        const resp = await fetchWithRetry(url, {});
        return resp.data.data;
    } catch (err) {
        console.error(`Error fetching card by ID ${id}:`, err?.response?.data || err.message);
        return null;
    }
}

/** === Search cards by name with AI set awareness === */
export async function searchCardsByName(name, aiSetName, limit = 10) {
    if (!name) return [];

    const cleaned = name.replace(/ (GX|V|EX|MEGA|BREAK|Prism Star|Tag Team)$/i, '').trim();
    const setId = SET_ID_MAP[aiSetName];

    let query = setId
        ? `name:"${cleaned}" set.id:"${setId}"`
        : `name:"${cleaned}*"`;

    console.log(`DEBUG: TCG Query: ${query}`);
    let results = [];

    try {
        const resp = await fetchWithRetry('/cards', { params: { q: query, pageSize: limit } });
        results = resp.data?.data || [];
    } catch (err) {
        console.warn("TCG search failed:", err.message);
    }

    // Fallback for normal sets
    if (!setId && results.length === 0) {
        const firstWord = cleaned.split(" ")[0];
        if (firstWord.length > 0 && cleaned.includes(" ")) {
            const fallbackQuery = `name:"${firstWord}*"`;
            console.log(`DEBUG: TCG Fallback Query: ${fallbackQuery}`);
            try {
                const fallbackResp = await fetchWithRetry('/cards', { params: { q: fallbackQuery, pageSize: limit } });
                results = fallbackResp.data?.data || [];
            } catch (err) {
                console.warn("Fallback TCG search failed:", err.message);
            }
        }
    }

    return results;
}

// Fetch all cards with the exact name and set
export async function fetchCardsByNameAndSet(name, set) {
    try {
        const resp = await searchCardsByName(name, 50); // get up to 50 results
        // Filter only cards from the matching set
        return resp.filter(c => c.set.name.toLowerCase() === set.toLowerCase());
    } catch (err) {
        console.error("Failed to fetch cards by name and set:", err);
        return [];
    }
}


/** === Extract best market price === */
export function extractMarketPrice(card) {
    if (!card) return null;

    if (card.cardmarket?.prices?.averageSellPrice) return card.cardmarket.prices.averageSellPrice;

    if (card.tcgplayer?.prices) {
        for (const key of ['holofoil','normal','reverseHolofoil','1stEditionHolofoil']) {
            if (card.tcgplayer.prices[key]?.market) return card.tcgplayer.prices[key].market;
        }
    }

    return null;
}
