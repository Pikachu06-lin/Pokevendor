// services/supabase-inventory.js
// Supabase inventory storage

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
   */
  async addCard(cardData) {
    try {
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
        added_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from(this.tableName)
        .insert([item])
        .select();

      if (error) {
        console.error('Supabase insert error:', error);
        throw error;
      }

      console.log(`✅ Added card to Supabase: ${item.card_name} (ID: ${data[0].id})`);
      return data[0];
    } catch (error) {
      console.error('Error adding card to Supabase:', error);
      throw error;
    }
  }

  /**
   * Get inventory count for a specific card
   */
  async getCardCount(cardName, setName = null) {
    try {
      let query = supabase
        .from(this.tableName)
        .select('id', { count: 'exact', head: true })
        .ilike('card_name', cardName);

      if (setName) {
        query = query.ilike('set_name', setName);
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
   * Get total inventory count
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
        bySource: {},
        byLanguage: {},
        byCondition: {},
        totalValue: 0
      };

      for (const item of items) {
        // Count by source
        const source = item.source || 'unknown';
        stats.bySource[source] = (stats.bySource[source] || 0) + 1;

        // Count by language
        const lang = item.language || 'unknown';
        stats.byLanguage[lang] = (stats.byLanguage[lang] || 0) + 1;

        // Count by condition
        const condition = item.condition || 'unknown';
        stats.byCondition[condition] = (stats.byCondition[condition] || 0) + 1;

        // Calculate total value
        if (item.listed_price) {
          stats.totalValue += parseFloat(item.listed_price);
        }
      }

      return stats;
    } catch (error) {
      console.error('Error getting stats from Supabase:', error);
      return {
        totalCards: 0,
        bySource: {},
        byLanguage: {},
        byCondition: {},
        totalValue: 0
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