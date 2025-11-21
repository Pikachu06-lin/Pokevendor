require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
  // 1️⃣ Add a card
  const newCard = {
    name: "Pikachu",
    set: "Base Set",
    number: "25",
    rarity: "Common",
    condition: "Near Mint",
    marketprice: 999,
    listedprice: 999,
    availability: true,
    imageurl: "https://images.pokemontcg.io/base1/25.png",
    source: "pokemontcg",
    language: "English",
    fetchedat: new Date()
  };

  const { data: addedCard, error: addError } = await supabase
    .from('cards')
    .insert([newCard])
    .select()
    .single();

  if (addError) {
    console.error("Error adding card:", addError.message);
    return;
  }

  console.log("✅ Card added:", addedCard);

  // 2️⃣ Update the card
  const updatedFields = {
    marketprice: 500,
    availability: false,
    condition: "Lightly Played"
  };

  const { data: updatedCard, error: updateError } = await supabase
    .from('cards')
    .update(updatedFields)
    .eq('id', addedCard.id)
    .select()
    .single();

  if (updateError) {
    console.error("Error updating card:", updateError.message);
    return;
  }

  console.log("✅ Card updated:", updatedCard);

  // 3️⃣ Delete the card
  const { data: deletedCard, error: deleteError } = await supabase
    .from('cards')
    .delete()
    .eq('id', addedCard.id)
    .select()
    .single();

  if (deleteError) {
    console.error("Error deleting card:", deleteError.message);
    return;
  }

  console.log("✅ Card deleted:", deletedCard);
}

main();
