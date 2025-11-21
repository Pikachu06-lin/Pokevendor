import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

import { requireAdmin } from "../middleware/auth.js";
import { searchCardsByName, extractMarketPrice } from "../services/pokemonTcg.js";
import { identifyCardWithGemini } from "../services/identifyCard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Multer (if needed later for real file uploads)
const upload = multer({
  dest: path.join(__dirname, "..", "uploads"),
  limits: { fileSize: 6 * 1024 * 1024 } // 6MB
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

/* ---------------------------------------------------------
   IDENTIFY CARD (MANUAL OR AI)
--------------------------------------------------------- */
router.post("/identify", requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabase(req);

    const {
      mode,
      base64Image,
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
        condition: condition || "unknown",
      };
    }

    /* -----------------------------------------
       MODE 2: AI IDENTIFICATION
    ----------------------------------------- */
    else if (mode === "2") {
      if (!base64Image) {
        return res.status(400).json({ error: "Missing Base64 image for AI mode" });
      }

      cardInfo = await identifyCardWithGemini(base64Image, condition || "unknown");

      if (!cardInfo?.name || !cardInfo?.set) {
        return res.status(500).json({ error: "AI could not identify the card" });
      }
    }

    else {
      return res.status(400).json({ error: "Invalid mode — use 1 or 2" });
    }

    /* -----------------------------------------
       MARKET PRICE LOOKUP (SKIPPED IF PROVIDED)
    ----------------------------------------- */
    let marketPrice = marketprice || null;

    if (!marketPrice) {
      try {
        const results = await searchCardsByName(cardInfo.name);
        const match = results.find(
          (c) => c.set?.name === cardInfo.set || c.set === cardInfo.set
        );
        marketPrice = match ? extractMarketPrice(match) : null;
      } catch (err) {
        console.warn("Market price fetch failed:", err.message);
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
      marketprice: marketPrice,
      listedprice: listedprice || null,
      availability: availability ?? true,
      imageurl: imageurl || null,
      source: mode === "2" ? "gemini" : "manual",
      fetchedat: new Date(),
    };

    /* -----------------------------------------
       INSERT INTO DATABASE — ALWAYS SAFE
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
