import axios from 'axios';

const API_BASE = 'https://api.tcgdex.net/v2';

const instance = axios.create({
  baseURL: API_BASE,
  timeout: 15000
});

async function fetchWithRetry(url, config) {
  const MAX_RETRIES = 5;
  const INITIAL_BACKOFF_MS = 1000;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await instance.get(url, config);
    } catch (err) {
      const status = err.response ? err.response.status : 'Network Error';
      if (i === MAX_RETRIES - 1 || (status !== 429 && status < 500 && status !== 'Network Error')) {
        throw err;
      }
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, i) + Math.floor(Math.random() * 500);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Fetch single card by id
export async function fetchCardById(id) {
  if (!id) return null;
  try {
    const resp = await fetchWithRetry(`/cards/${id}`, {});
    return resp.data;  // TCGdex returns the Card object directly
  } catch (err) {
    console.error(`TCGdex: error fetching card ${id}`, err);
    return null;
  }
}

// Search cards by name (basic)
export async function searchCardsByName(name, limit = 10) {
  if (!name) return [];
  try {
    const resp = await fetchWithRetry('/cards', { params: { q: `name:"${name}"`, pageSize: limit }});
    return resp.data || [];
  } catch (err) {
    console.error('TCGdex: card search failed', err);
    return [];
  }
}
