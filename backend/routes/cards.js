import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { requireAdmin } from "../middleware/auth.js";
import { searchCardsByName, extractMarketPrice } from "../services/pokemonTcg.js";
import { identifyCardWithGemini } from "../services/identifyCard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ---------------------------------------------------------
// 1. MULTER DISK STORAGE CONFIG
// ---------------------------------------------------------
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Path resolves to the 'backend/uploads' folder
        cb(null, path.join(__dirname, "..", "uploads"));
    },
    filename: function (req, file, cb) {
        // Creates a unique filename (e.g., cardImage-1700980000.png)
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage, // Use the configured disk storage
    limits: { fileSize: 6 * 1024 * 1024 } // 6MB limit
});

// Pull Supabase client from server.js
const getSupabase = (req) => req.app.locals.supabase;

/* ---------------------------------------------------------
   GET ALL CARDS
--------------------------------------------------------- */
router.get("/", async (req, res) => {
  try {
    const supabase = getSupabase(req);

    const { data, error } = await supabase
      .from("cards")
      .select("*")
      .order("fetchedat", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------
   GET ONE CARD
--------------------------------------------------------- */
router.get("/:id", async (req, res) => {
  try {
    const supabase = getSupabase(req);

    const { data, error } = await supabase
      .from("cards")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: "Card not found" });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add this route BEFORE the existing "/identify" route in your cards.js file

/* ---------------------------------------------------------
   IDENTIFY CARD FROM BASE64 IMAGE (AI ONLY - FOR FRONTEND)
   - Receives base64 image and language from frontend
   - Returns card identification without saving to database
--------------------------------------------------------- */
router.post("/identify-image", requireAdmin, async (req, res) => {
    try {
        const { base64Image, language } = req.body;
        
        if (!base64Image) {
            return res.status(400).json({ error: "base64Image is required" });
        }
        
        const targetLanguage = language || 'en';
        
        // Import the new function from your gemini service
        const { identifyCardFromBase64 } = await import('../services/gemini.js');
        
        // Call Gemini service with base64 image
        const cardInfo = await identifyCardFromBase64(base64Image, targetLanguage);
        
        if (!cardInfo || !cardInfo.name) {
            return res.status(500).json({ error: "AI could not identify the card" });
        }
        
        console.log("✅ AI identified card from frontend:", cardInfo);
        
        res.json({ 
            success: true,
            card: cardInfo 
        });
        
    } catch (err) {
        console.error("AI identification error:", err);
        res.status(500).json({ 
            error: "AI identification failed",
            details: err.message 
        });
    }
});

/* ---------------------------------------------------------
   IDENTIFY CARD (MANUAL OR AI)
    - Uses Multer middleware to handle file upload for Mode 2.
--------------------------------------------------------- */
// Apply Multer middleware: 'upload.single('cardImage')'
router.post("/identify", requireAdmin, upload.single('cardImage'), async (req, res) => {
    // Variable to hold the local path of the uploaded file for mandatory cleanup
    let uploadedFilePath = null;
    
    try {
        const supabase = getSupabase(req);

        // req.body contains all non-file fields (mode, condition, etc.)
        const {
            mode,
            name,
            set,
            number,
            rarity,
            language,
            condition,
            marketprice,
            listedprice,
            availability,
            imageurl
        } = req.body; 
        
        // Ensure all mode-dependent variables are available
        const cardCondition = condition || "unknown";
        let cardInfo = null;

        /* -----------------------------------------
           MODE 1: MANUAL ENTRY
        ----------------------------------------- */
        if (mode === "1") {
           if (!name || !set) {
               return res.status(400).json({ error: "Manual mode requires name + set" });
           }

           cardInfo = {
               name,
               set,
               number: number || null,
               rarity: rarity || "Common",
               language: language || "EN",
               condition: cardCondition,
           };
       }

        /* -----------------------------------------
           MODE 2: AI IDENTIFICATION 
        ----------------------------------------- */
       else if (mode === "2") {
           if (!req.file) { 
               return res.status(400).json({ error: "Missing image file for AI mode" });
           }

            // Store the path for cleanup
            uploadedFilePath = req.file.path;
            
            // Call Gemini service with the local file path and MIME type
           cardInfo = await identifyCardWithGemini(
                uploadedFilePath, 
                req.file.mimetype, // MIME type detected by Multer
                cardCondition
            );

           if (!cardInfo?.name || !cardInfo?.set) {
               return res.status(500).json({ error: "AI could not identify the card" });
           }
            
            // ----------------------------------------------------
            // 💡 DEBUG LOG 1: Check what the AI identified
            // ----------------------------------------------------
            console.log(`\n--- DEBUG MARKET PRICE LOOKUP ---`);
            console.log(`[1/4] AI Identified Card: ${cardInfo.name}`);
            console.log(`[1/4] AI Identified Set: ${cardInfo.set}`);
            console.log(`---------------------------------`);

       }

       else {
           return res.status(400).json({ error: "Invalid mode — use 1 or 2" });
       }

        /* -----------------------------------------
           MARKET PRICE LOOKUP
        ----------------------------------------- */
        let marketPrice = marketprice || null;

       if (!marketPrice) {
           try {
               const results = await searchCardsByName(cardInfo.name);
        
                // ----------------------------------------------------
                // 💡 DEBUG LOG 2: Check TCG API results count and set names
                // ----------------------------------------------------
                console.log(`[2/4] TCG Search Results Count for '${cardInfo.name}': ${results.length}`);
                if (results.length > 0) {
                    const tcgSets = results.map(c => c.set?.name || c.set);
                    console.log(`[2/4] Available TCG Set Names:`, tcgSets);
                }
                
                // CRITICAL MATCHING LOGIC
               const match = results.find(
                   // Check for exact match on TCG API's 'set.name' or fallback 'set' property
                   (c) => c.set?.name === cardInfo.set || c.set === cardInfo.set
               );

                // ----------------------------------------------------
                // 💡 DEBUG LOG 3: Check if a set match was found
                // ----------------------------------------------------
                console.log(`[3/4] Successful Set Match Found: ${!!match}`);
                
               marketPrice = match ? extractMarketPrice(match) : null;
                
                // ----------------------------------------------------
                // 💡 DEBUG LOG 4: Check the final extracted price
                // ----------------------------------------------------
                console.log(`[4/4] Final Extracted Market Price: ${marketPrice}`);

           } catch (err) {
               console.warn("Market price fetch failed (API error):", err.message);
           }
       }

        /* -----------------------------------------
           FINAL CARD DATA FOR DATABASE
        ----------------------------------------- */
       const finalData = {
           name: cardInfo.name,
           set: cardInfo.set,
           number: cardInfo.number || null,
           rarity: cardInfo.rarity || "Common",
           language: cardInfo.language || "EN",
           condition: cardInfo.condition || "unknown",
           marketprice: marketPrice, // Will be null if lookup failed
           listedprice: listedprice || null,
           availability: availability ?? true,
           imageurl: imageurl || null,
           source: mode === "2" ? "gemini" : "manual",
           fetchedat: new Date(),
       };

        console.log("✅ Final Card Data Ready for DB:", finalData);

        /* -----------------------------------------
           INSERT INTO DATABASE
        ----------------------------------------- */
       const { data, error } = await supabase
           .from("cards")
           .insert([finalData])
           .select()
           .single();

       if (error) return res.status(500).json({ error: error.message });

       return res.json({ card: data, marketPrice });

   } catch (err) {
       console.error("identify/import error:", err);
       res.status(500).json({ error: err.message });
   } finally {
        // 🗑️ ALWAYS clean up the temporary file, regardless of success or failure
        if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
            console.log("Cleaning up temporary file:", uploadedFilePath);
            fs.unlinkSync(uploadedFilePath);
        }
    }
});

/* ---------------------------------------------------------
   UPDATE A CARD — FIXED
--------------------------------------------------------- */
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabase(req);

    // Only these fields are allowed to update:
    const allowedFields = [
      "name",
      "set",
      "number",
      "rarity",
      "language",
      "condition",
      "marketprice",
      "listedprice",
      "availability",
      "imageurl"
    ];

    // Filter body for allowed keys only
    const updateData = {};
    for (const key of allowedFields) {
      if (key in req.body) {
        updateData[key] = req.body[key];
      }
    }

    // Perform update
    const { data, error } = await supabase
      .from("cards")
      .update(updateData)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Card not found" });

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ---------------------------------------------------------
   DELETE A CARD
--------------------------------------------------------- */
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabase(req);

    const { error } = await supabase
      .from("cards")
      .delete()
      .eq("id", req.params.id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;