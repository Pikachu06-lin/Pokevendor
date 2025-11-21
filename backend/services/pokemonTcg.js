import axios from 'axios';

const API_BASE = 'https://api.pokemontcg.io/v2';
const instance = axios.create({
  baseURL: API_BASE,
  headers: { 'X-Api-Key': process.env.POKEMON_TCG_KEY || '' },
  timeout: 10000
});

export async function searchCardsByName(name, limit = 10) {
  try {
    const q = `name:"${name}"`;
    const resp = await instance.get('/cards', { params: { q, pageSize: limit } });
    return resp.data?.data || [];
  } catch (err) {
    console.error('PokéTCG search error:', err?.response?.data || err.message);
    return [];
  }
}

export function extractMarketPrice(card) {
  if (!card) return null;
  if (card.cardmarket?.prices?.averageSellPrice) return card.cardmarket.prices.averageSellPrice;
  if (card.tcgplayer?.prices) {
    for (const k of ['holofoil','normal','reverseHolofoil','1stEditionHolofoil']) {
      if (card.tcgplayer.prices[k]?.market) return card.tcgplayer.prices[k].market;
    }
  }
  return null;
}
