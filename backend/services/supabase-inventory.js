// services/supabase-inventory.js
// Supabase inventory storage with stock management

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Make sure dotenv is loaded
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('🔍 Checking Supabase credentials...');
console.log('SUPABASE_URL:', supabaseUrl ? '✅ Found' : '❌ Missing');
console.log('SUPABASE_KEY:', supabaseKey ? '✅ Found' : '❌ Missing');

if (!supabaseUrl || !supabaseKey) {
  console.error('⚠️ Supabase credentials missing!');
  console.error('Please set SUPABASE_URL and SUPABASE_KEY in your .env file');
  throw new Error('Supabase credentials are required');
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Supabase client initialized successfully');

class SupabaseInventory {
  constructor() {
    this.tableName = 'inventory'; // Your Supabase table name
  }

  /**
   * Add a card to inventory in Supabase
   * If card already exists (same name, set, number, condition, language), increment stock
   * Otherwise, create new entry with stock = 1
   */
  async addCard(cardData) {
    try {
      // Check if this exact card already exists
      const existingCard = await this.findExactCard(
        cardData.card.name,
        cardData.card.set_name,
        cardData.card.number,
        cardData.condition,
        cardData.language
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
      const item = {
        card_name: cardData.card.name,
        set_name: cardData.card.set_name || null,
        card_number: cardData.card.number || null,
        rarity: cardData.card.rarity || null,
        image_url: cardData.card.image_url || null,
        market_price: cardData.card.price ? (cardData.card.price / 100) : 0, // Convert cents to dollars
        listed_price: cardData.card.listedPrice || 0, // Already in dollars
        condition: cardData.condition,
        language: cardData.language,
        source: cardData.card.source || 'unknown',
        availability: true,
        added_at: new Date().toISOString(),
        stock: 1
      };

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
   * Find exact card match (name + set + number + condition + language)
   */
  async findExactCard(cardName, setName, cardNumber, condition, language) {
    try {
      let query = supabase
        .from(this.tableName)
        .select('*')
        .ilike('card_name', cardName)
        .eq('condition', condition)
        .eq('language', language);

      if (setName) {
        query = query.ilike('set_name', setName);
      }

      if (cardNumber) {
        query = query.eq('card_number', cardNumber);
      }

      const { data, error } = await query.limit(1).single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - card doesn't exist
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
   * Decrease stock by 1 (when card is sold)
   * If stock reaches 0, optionally mark as unavailable or delete
   */
  async decrementStock(id, deleteWhenZero = false) {
    try {
      // Get current card
      const { data: currentCard, error: fetchError } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !currentCard) {
        console.error('Card not found:', fetchError);
        throw new Error('Card not found');
      }

      const currentStock = currentCard.stock || 0;
      
      if (currentStock <= 0) {
        console.warn(`⚠️ Cannot decrement - stock already at 0 for card: ${currentCard.card_name}`);
        return currentCard;
      }

      const newStock = currentStock - 1;

      if (newStock === 0 && deleteWhenZero) {
        // Delete the card entirely
        return await this.removeCard(id);
      } else if (newStock === 0) {
        // Mark as unavailable but keep in database
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
        console.log(`📉 Stock depleted for: ${currentCard.card_name} (marked unavailable)`);
        return data[0];
      } else {
        // Just decrease stock
        const { data, error } = await supabase
          .from(this.tableName)
          .update({ 
            stock: newStock,
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .select();

        if (error) throw error;
        console.log(`📉 Decremented stock for: ${currentCard.card_name} (Stock: ${currentStock} → ${newStock})`);
        return data[0];
      }
    } catch (error) {
      console.error('Error decrementing stock:', error);
      throw error;
    }
  }

  /**
   * Increase stock by a specified amount
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
          availability: true, // Make available again if it was unavailable
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      console.log(`📈 Incremented stock for: ${currentCard.card_name} (Stock: ${currentStock} → ${newStock})`);
      return data[0];
    } catch (error) {
      console.error('Error incrementing stock:', error);
      throw error;
    }
  }

  /**
   * Set stock to a specific value
   */
  async setStock(id, quantity) {
    try {
      const { data: currentCard, error: fetchError } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !currentCard) {
        throw new Error('Card not found');
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .update({ 
          stock: quantity,
          availability: quantity > 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      console.log(`🔢 Set stock for: ${currentCard.card_name} (Stock: ${currentCard.stock} → ${quantity})`);
      return data[0];
    } catch (error) {
      console.error('Error setting stock:', error);
      throw error;
    }
  }

  /**
   * Get total stock quantity across all cards
   */
  async getTotalStock() {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('stock');

      if (error) throw error;

      const totalStock = data.reduce((sum, item) => sum + (item.stock || 0), 0);
      return totalStock;
    } catch (error) {
      console.error('Error getting total stock:', error);
      return 0;
    }
  }

  /**
   * Get inventory count for a specific card (by name + set + number)
   */
  async getCardCount(cardName, setName = null, cardNumber = null) {
    try {
      let query = supabase
        .from(this.tableName)
        .select('id', { count: 'exact', head: true })
        .ilike('card_name', cardName);

      // Match by set name if provided
      if (setName) {
        query = query.ilike('set_name', setName);
      }

      // Match by card number if provided (most specific identifier)
      if (cardNumber) {
        query = query.eq('card_number', cardNumber);
      }

      const { count, error } = await query;

      if (error) {
        console.error('Supabase count error:', error);
        throw error;
      }

      return count || 0;
    } catch (error) {
      console.error('Error getting card count from Supabase:', error);
      return 0;
    }
  }

  /**
   * Get stock quantity for a specific card
   */
  async getCardStock(cardName, setName = null, cardNumber = null) {
    try {
      let query = supabase
        .from(this.tableName)
        .select('stock')
        .ilike('card_name', cardName);

      if (setName) {
        query = query.ilike('set_name', setName);
      }

      if (cardNumber) {
        query = query.eq('card_number', cardNumber);
      }

      const { data, error } = await query;

      if (error) throw error;

      const totalStock = data.reduce((sum, item) => sum + (item.stock || 0), 0);
      return totalStock;
    } catch (error) {
      console.error('Error getting card stock:', error);
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
        .order('added_at', { ascending: false });

      if (error) {
        console.error('Supabase select error:', error);
        throw error;
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
        query = query.ilike('set_name', `%${filters.setName}%`);
      }

      if (filters.language) {
        query = query.eq('language', filters.language);
      }

      if (filters.condition) {
        query = query.eq('condition', filters.condition);
      }

      if (filters.source) {
        query = query.eq('source', filters.source);
      }

      if (filters.inStock) {
        query = query.gt('stock', 0);
      }

      query = query.order('added_at', { ascending: false });

      const { data, error } = await query;

      if (error) {
        console.error('Supabase filtered select error:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error getting filtered items from Supabase:', error);
      return [];
    }
  }

  /**
   * Remove a card from inventory by ID
   */
  async removeCard(id) {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id)
        .select();

      if (error) {
        console.error('Supabase delete error:', error);
        throw error;
      }

      if (data && data.length > 0) {
        console.log(`🗑️ Removed card from Supabase: ${data[0].card_name} (ID: ${id})`);
        return data[0];
      }

      return null;
    } catch (error) {
      console.error('Error removing card from Supabase:', error);
      throw error;
    }
  }

  /**
   * Update a card in inventory
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

      if (error) {
        console.error('Supabase update error:', error);
        throw error;
      }

      if (data && data.length > 0) {
        console.log(`✏️ Updated card in Supabase: ${data[0].card_name} (ID: ${id})`);
        return data[0];
      }

      return null;
    } catch (error) {
      console.error('Error updating card in Supabase:', error);
      throw error;
    }
  }

  /**
   * Get total inventory count (number of unique cards)
   */
  async getTotalCount() {
    try {
      const { count, error } = await supabase
        .from(this.tableName)
        .select('id', { count: 'exact', head: true });

      if (error) {
        console.error('Supabase total count error:', error);
        throw error;
      }

      return count || 0;
    } catch (error) {
      console.error('Error getting total count from Supabase:', error);
      return 0;
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
        bySource: {},
        byLanguage: {},
        byCondition: {},
        totalValue: 0,
        outOfStock: 0,
        lowStock: 0 // Cards with stock <= 3
      };

      for (const item of items) {
        const stock = item.stock || 0;
        stats.totalStock += stock;

        // Count by source
        const source = item.source || 'unknown';
        stats.bySource[source] = (stats.bySource[source] || 0) + stock;

        // Count by language
        const lang = item.language || 'unknown';
        stats.byLanguage[lang] = (stats.byLanguage[lang] || 0) + stock;

        // Count by condition
        const condition = item.condition || 'unknown';
        stats.byCondition[condition] = (stats.byCondition[condition] || 0) + stock;

        // Calculate total value
        if (item.listed_price) {
          stats.totalValue += parseFloat(item.listed_price) * stock;
        }

        // Track out of stock
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
        bySource: {},
        byLanguage: {},
        byCondition: {},
        totalValue: 0,
        outOfStock: 0,
        lowStock: 0
      };
    }
  }

  /**
   * Clear all inventory (use with caution!)
   */
  async clearAll() {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .delete()
        .neq('id', 0); // Delete all rows

      if (error) {
        console.error('Supabase clear all error:', error);
        throw error;
      }

      const count = data ? data.length : 0;
      console.log(`🗑️ Cleared all inventory from Supabase (${count} items removed)`);
      return count;
    } catch (error) {
      console.error('Error clearing all from Supabase:', error);
      throw error;
    }
  }
}

// Create singleton instance
const supabaseInventory = new SupabaseInventory();

export default supabaseInventory;