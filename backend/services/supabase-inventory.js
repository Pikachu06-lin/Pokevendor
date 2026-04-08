// services/supabase-inventory.js
// Supabase inventory storage - clean version matching actual table structure

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

class SupabaseInventory {
  constructor() {
    this.tableName = 'inventory';
  }

  /**
   * Add a card to inventory
   * If card already exists, increment stock
   */
  async addCard(cardData) {
    try {
      console.log('🔍 addCard called with full cardData:', JSON.stringify(cardData, null, 2));
      console.log('🔍 cardData.card:', JSON.stringify(cardData.card, null, 2));
      console.log('🔍 cardData.card.price:', cardData.card.price, 'Type:', typeof cardData.card.price);
      console.log('🔍 cardData.sku:', cardData.sku, 'Type:', typeof cardData.sku);

      // Check if card exists (by card name, language, and card number)
      const existingCard = await this.findExactCard(
        cardData.card.name,
        cardData.language,
        cardData.card.number
      );

      if (existingCard) {
        // Card exists - increment stock
        const newStock = (existingCard.stock || 0) + 1;
        const { data, error } = await supabase
          .from(this.tableName)
          .update({ 
            stock: newStock,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingCard.id)
          .select();

        if (error) {
          console.error('Supabase update stock error:', error);
          throw error;
        }

        console.log(`✅ Incremented stock for: ${existingCard.card_name} (Stock: ${existingCard.stock} → ${newStock})`);
        return data[0];
      }

      // Card doesn't exist - create new entry
      // Table columns: sku, card_name, set, card_number, rarity, image_url, price, condition, language, availability, stock
      const item = {
        sku: cardData.sku || null,
        card_name: cardData.card.name,
        set: cardData.card.set || cardData.card.set_name || null,
        card_number: null,//cardData.card.number || null,
        rarity: cardData.card.rarity || null,
        image_url: cardData.card.image_url || null,
        price: parseFloat(cardData.card.price || 0) / 100, // Ensure it's a number
        condition: cardData.condition || 'NM',
        language: cardData.language,
        availability: true,
        stock: 1
      };

      console.log('📝 About to insert item:', JSON.stringify(item, null, 2));
      console.log('📝 Item.price:', item.price, 'Type:', typeof item.price);
      console.log('📝 Item.sku:', item.sku, 'Type:', typeof item.sku);

      const { data, error } = await supabase
        .from(this.tableName)
        .insert([item])
        .select();

      if (error) {
        console.error('Supabase insert error:', error);
        throw error;
      }

      console.log(`✅ Added new card to Supabase: ${item.card_name} (Stock: 1)`);
      return data[0];
    } catch (error) {
      console.error('Error adding card to Supabase:', error);
      throw error;
    }
  }

  /**
   * Find exact card match (name, language, and card number)
   */
  async findExactCard(cardName, language, cardNumber = null) {
    try {
      let query = supabase
        .from(this.tableName)
        .select('*')
        .ilike('card_name', cardName)
        .eq('language', language);

      if (cardNumber) {
        query = query.eq('card_number', cardNumber);
      }

      const { data, error } = await query
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('Supabase find exact card error:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error finding exact card:', error);
      return null;
    }
  }

  /**
   * Decrease stock by 1
   */
  async decrementStock(id, deleteWhenZero = false) {
    try {
      const { data: currentCard, error: fetchError } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !currentCard) {
        throw new Error('Card not found');
      }

      const currentStock = currentCard.stock || 0;
      
      if (currentStock <= 0) {
        console.warn(`⚠️ Cannot decrement - stock already at 0`);
        return currentCard;
      }

      const newStock = currentStock - 1;

      if (newStock === 0 && deleteWhenZero) {
        return await this.removeCard(id);
      } else if (newStock === 0) {
        const { data, error } = await supabase
          .from(this.tableName)
          .update({ 
            stock: 0,
            availability: false,
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .select();

        if (error) throw error;
        console.log(`📉 Stock depleted (marked unavailable)`);
        return data[0];
      } else {
        const { data, error } = await supabase
          .from(this.tableName)
          .update({ 
            stock: newStock,
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .select();

        if (error) throw error;
        console.log(`📉 Decremented stock (Stock: ${currentStock} → ${newStock})`);
        return data[0];
      }
    } catch (error) {
      console.error('Error decrementing stock:', error);
      throw error;
    }
  }

  /**
   * Increase stock
   */
  async incrementStock(id, quantity = 1) {
    try {
      const { data: currentCard, error: fetchError } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !currentCard) {
        throw new Error('Card not found');
      }

      const currentStock = currentCard.stock || 0;
      const newStock = currentStock + quantity;

      const { data, error } = await supabase
        .from(this.tableName)
        .update({ 
          stock: newStock,
          availability: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      console.log(`📈 Incremented stock (Stock: ${currentStock} → ${newStock})`);
      return data[0];
    } catch (error) {
      console.error('Error incrementing stock:', error);
      throw error;
    }
  }

  /**
   * Get inventory count
   */
  async getCardCount(cardName, setName = null, cardNumber = null) {
    try {
      let query = supabase
        .from(this.tableName)
        .select('id', { count: 'exact', head: true })
        .ilike('card_name', `%${cardName}%`);

      // Use 'set' column (not 'set_name')
      if (setName) {
        query = query.ilike('set', `%${setName}%`);
      }

      if (cardNumber) {
        query = query.eq('card_number', cardNumber);
      }

      const { count, error } = await query;

      if (error) {
        console.error('Supabase count error:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Error getting card count from Supabase:', error);
      return 0;
    }
  }

  /**
   * Get all inventory items
   */
  async getAllItems() {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase select error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting all items from Supabase:', error);
      return [];
    }
  }

  /**
   * Get inventory items with filters
   */
  async getItems(filters = {}) {
    try {
      let query = supabase.from(this.tableName).select('*');

      if (filters.cardName) {
        query = query.ilike('card_name', `%${filters.cardName}%`);
      }

      if (filters.setName) {
        query = query.ilike('set', `%${filters.setName}%`);
      }

      if (filters.language) {
        query = query.eq('language', filters.language);
      }

      if (filters.condition) {
        query = query.eq('condition', filters.condition);
      }

      if (filters.inStock) {
        query = query.gt('stock', 0);
      }

      query = query.order('created_at', { ascending: false});

      const { data, error } = await query;

      if (error) {
        console.error('Supabase filtered select error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting filtered items from Supabase:', error);
      return [];
    }
  }

  /**
   * Get inventory statistics
   */
  async getStats() {
    try {
      const items = await this.getAllItems();

      const stats = {
        totalCards: items.length,
        totalStock: 0,
        byLanguage: {},
        byCondition: {},
        totalValue: 0,
        outOfStock: 0,
        lowStock: 0
      };

      for (const item of items) {
        const stock = item.stock || 0;
        stats.totalStock += stock;

        const lang = item.language || 'unknown';
        stats.byLanguage[lang] = (stats.byLanguage[lang] || 0) + stock;

        const condition = item.condition || 'unknown';
        stats.byCondition[condition] = (stats.byCondition[condition] || 0) + stock;

        if (item.price) {
          stats.totalValue += parseFloat(item.price) * stock;
        }

        if (stock === 0) {
          stats.outOfStock++;
        } else if (stock <= 3) {
          stats.lowStock++;
        }
      }

      return stats;
    } catch (error) {
      console.error('Error getting stats from Supabase:', error);
      return {
        totalCards: 0,
        totalStock: 0,
        byLanguage: {},
        byCondition: {},
        totalValue: 0,
        outOfStock: 0,
        lowStock: 0
      };
    }
  }

  /**
   * Remove a card
   */
  async removeCard(id) {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id)
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        console.log(`🗑️ Removed card: ${data[0].card_name}`);
        return data[0];
      }

      return null;
    } catch (error) {
      console.error('Error removing card:', error);
      throw error;
    }
  }

  /**
   * Update a card
   */
  async updateCard(id, updates) {
    try {
      const updateData = {
        ...updates,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from(this.tableName)
        .update(updateData)
        .eq('id', id)
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        console.log(`✏️ Updated card: ${data[0].card_name}`);
        return data[0];
      }

      return null;
    } catch (error) {
      console.error('Error updating card:', error);
      throw error;
    }
  }

  /**
   * Get total inventory count
   */
  async getTotalCount() {
    try {
      const { count, error } = await supabase
        .from(this.tableName)
        .select('id', { count: 'exact', head: true });

      if (error) {
        console.error('Supabase total count error:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Error getting total count:', error);
      return 0;
    }
  }
}

// Create singleton instance
const supabaseInventory = new SupabaseInventory();

export default supabaseInventory;