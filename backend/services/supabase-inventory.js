// services/supabase-inventory.js
// Supabase inventory storage — fixed field mapping for tcgapi.dev card structure

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('🔍 Checking Supabase credentials...');
console.log('SUPABASE_URL:', supabaseUrl ? '✅ Found' : '❌ Missing');
console.log('SUPABASE_KEY:', supabaseKey ? '✅ Found' : '❌ Missing');

if (!supabaseUrl || !supabaseKey) {
  console.error('⚠️ Supabase credentials missing!');
  throw new Error('Supabase credentials are required');
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Supabase client initialized successfully');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the numeric sequence from a card number string.
 * "005/086"  → 5
 * "167/086"  → 167
 * "115"      → 115
 * "SWSH001"  → null  (non-numeric prefix — don't store)
 */
function parseCardNumber(raw) {
  if (!raw) return null;
  const seq = String(raw).split('/')[0].trim().replace(/^0+/, '') || '0';
  const num = parseInt(seq, 10);
  return isNaN(num) ? null : num;
}

/**
 * Safely parse a float price, returning 0 on failure.
 */
function safePrice(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100; // round to 2dp
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class SupabaseInventory {
  constructor() {
    this.tableName = 'inventory';
  }

  // -------------------------------------------------------------------------
  // addCard
  // -------------------------------------------------------------------------
  async addCard(cardData) {
    try {
      const card     = cardData.card     || {};
      const quantity = Math.max(1, parseInt(cardData.quantity) || 1);

      // listedPrice is what the user typed in the UI.
      // marketPrice is the reference price from tcgapi.dev.
      // The "price" column in Supabase stores the listed (selling) price.
      const listedPrice = safePrice(card.listedPrice ?? card.marketPrice ?? 0);
      const cardNumber  = parseCardNumber(card.number);

      console.log(`📦 addCard: "${card.name}" | qty: ${quantity} | listedPrice: $${listedPrice} | cardNumber: ${cardNumber}`);

      // Check if this exact card already exists in inventory
      const existingCard = await this.findExactCard(card.name, cardData.language, cardNumber);

      if (existingCard) {
        // Increment stock by the requested quantity
        const newStock = (existingCard.stock || 0) + quantity;

        const { data, error } = await supabase
          .from(this.tableName)
          .update({
            stock:      newStock,
            price:      listedPrice, // update to latest listed price
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingCard.id)
          .select();

        if (error) {
          console.error('Supabase update stock error:', error);
          throw error;
        }

        console.log(`✅ Incremented stock: ${existingCard.card_name} (${existingCard.stock} → ${newStock})`);
        return data[0];
      }

      // New card — insert row
      // Columns: sku, card_name, set, card_number, rarity, image_url,
      //          price, condition, language, availability, stock
      const item = {
        sku:         null,
        card_name:   card.name                         || 'Unknown',
        set:         card.set_name || card.set         || null,
        card_number: cardNumber,                        // numeric or null
        rarity:      card.rarity                       || null,
        image_url:   card.image_url || card.imageUrl   || null,
        price:       listedPrice,                       // listed selling price
        condition:   cardData.condition                || 'Near Mint',
        language:    cardData.language                 || 'Unknown',
        availability: true,
        stock:       quantity,
      };

      console.log('📝 Inserting:', JSON.stringify(item, null, 2));

      const { data, error } = await supabase
        .from(this.tableName)
        .insert([item])
        .select();

      if (error) {
        console.error('Supabase insert error:', error);
        throw error;
      }

      console.log(`✅ Added new card: ${item.card_name} | price: $${item.price} | stock: ${item.stock}`);
      return data[0];

    } catch (error) {
      console.error('Error adding card to Supabase:', error);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // findExactCard — match by name + language; optionally by numeric card_number
  // -------------------------------------------------------------------------
  async findExactCard(cardName, language, cardNumber = null) {
    try {
      let query = supabase
        .from(this.tableName)
        .select('*')
        .ilike('card_name', cardName)
        .eq('language', language);

      // Only filter by card_number if we have a valid integer
      // (avoids the "invalid input syntax for type numeric" error)
      if (cardNumber !== null && Number.isInteger(cardNumber)) {
        query = query.eq('card_number', cardNumber);
      }

      const { data, error } = await query.limit(1).single();

      if (error) {
        if (error.code === 'PGRST116') return null; // no row found
        console.error('Supabase findExactCard error:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error finding exact card:', error);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // getCardCount — used by the UI to show "In Stock" badges
  // -------------------------------------------------------------------------
  async getCardCount(cardName, setName = null, cardNumber = null) {
    try {
      let query = supabase
        .from(this.tableName)
        .select('stock')
        .ilike('card_name', `%${cardName}%`);

      if (setName) {
        query = query.ilike('set', `%${setName}%`);
      }

      // Only apply card_number filter when it's a clean integer
      const numericCardNumber = parseCardNumber(cardNumber);
      if (numericCardNumber !== null) {
        query = query.eq('card_number', numericCardNumber);
      }

      const { data, error } = await query;

      if (error) {
        // Log quietly — count errors are non-critical for the UI
        console.warn('⚠️ getCardCount error:', error.message);
        return 0;
      }

      // Sum stock across all matching rows
      return (data || []).reduce((sum, row) => sum + (row.stock || 0), 0);

    } catch (error) {
      console.error('Error getting card count:', error);
      return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Decrement stock
  // -------------------------------------------------------------------------
  async decrementStock(id, deleteWhenZero = false) {
    try {
      const { data: currentCard, error: fetchError } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !currentCard) throw new Error('Card not found');

      const currentStock = currentCard.stock || 0;

      if (currentStock <= 0) {
        console.warn('⚠️ Cannot decrement — stock already at 0');
        return currentCard;
      }

      const newStock = currentStock - 1;

      if (newStock === 0 && deleteWhenZero) {
        return await this.removeCard(id);
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .update({
          stock:        newStock,
          availability: newStock > 0,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      console.log(`📉 Stock: ${currentStock} → ${newStock}`);
      return data[0];

    } catch (error) {
      console.error('Error decrementing stock:', error);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Increment stock
  // -------------------------------------------------------------------------
  async incrementStock(id, quantity = 1) {
    try {
      const { data: currentCard, error: fetchError } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !currentCard) throw new Error('Card not found');

      const newStock = (currentCard.stock || 0) + quantity;

      const { data, error } = await supabase
        .from(this.tableName)
        .update({
          stock:        newStock,
          availability: true,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      console.log(`📈 Stock: ${currentCard.stock} → ${newStock}`);
      return data[0];

    } catch (error) {
      console.error('Error incrementing stock:', error);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------
  async getAllItems() {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) { console.error('Supabase select error:', error); return []; }
      return data || [];
    } catch (error) {
      console.error('Error getting all items:', error);
      return [];
    }
  }

  async getItems(filters = {}) {
    try {
      let query = supabase.from(this.tableName).select('*');

      if (filters.cardName)  query = query.ilike('card_name', `%${filters.cardName}%`);
      if (filters.setName)   query = query.ilike('set', `%${filters.setName}%`);
      if (filters.language)  query = query.eq('language', filters.language);
      if (filters.condition) query = query.eq('condition', filters.condition);
      if (filters.inStock)   query = query.gt('stock', 0);

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) { console.error('Supabase filtered select error:', error); return []; }
      return data || [];
    } catch (error) {
      console.error('Error getting filtered items:', error);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------
  async getStats() {
    try {
      const items = await this.getAllItems();

      const stats = {
        totalCards:  items.length,
        totalStock:  0,
        byLanguage:  {},
        byCondition: {},
        totalValue:  0,
        outOfStock:  0,
        lowStock:    0,
      };

      for (const item of items) {
        const stock = item.stock || 0;
        stats.totalStock += stock;

        const lang = item.language || 'unknown';
        stats.byLanguage[lang] = (stats.byLanguage[lang] || 0) + stock;

        const cond = item.condition || 'unknown';
        stats.byCondition[cond] = (stats.byCondition[cond] || 0) + stock;

        if (item.price) stats.totalValue += safePrice(item.price) * stock;
        if (stock === 0) stats.outOfStock++;
        else if (stock <= 3) stats.lowStock++;
      }

      return stats;
    } catch (error) {
      console.error('Error getting stats:', error);
      return { totalCards: 0, totalStock: 0, byLanguage: {}, byCondition: {}, totalValue: 0, outOfStock: 0, lowStock: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // Remove / Update
  // -------------------------------------------------------------------------
  async removeCard(id) {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id)
        .select();

      if (error) throw error;
      if (data?.length > 0) {
        console.log(`🗑️ Removed: ${data[0].card_name}`);
        return data[0];
      }
      return null;
    } catch (error) {
      console.error('Error removing card:', error);
      throw error;
    }
  }

  async updateCard(id, updates) {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select();

      if (error) throw error;
      if (data?.length > 0) {
        console.log(`✏️ Updated: ${data[0].card_name}`);
        return data[0];
      }
      return null;
    } catch (error) {
      console.error('Error updating card:', error);
      throw error;
    }
  }

  async getTotalCount() {
    try {
      const { count, error } = await supabase
        .from(this.tableName)
        .select('id', { count: 'exact', head: true });

      if (error) { console.error('Supabase total count error:', error); return 0; }
      return count || 0;
    } catch (error) {
      console.error('Error getting total count:', error);
      return 0;
    }
  }
}

// Singleton
const supabaseInventory = new SupabaseInventory();
export default supabaseInventory;