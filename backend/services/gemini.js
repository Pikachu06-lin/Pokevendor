//console.log("GEMINI_API_KEY loaded:", process.env.GEMINI_API_KEY);
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';

// Initialize the Gemini AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Identifies a Pokémon card from a base64 image string (for frontend uploads)
 * ALWAYS returns card name in ENGLISH for database searching
 * @param {string} base64Image - Base64 encoded image (with data:image prefix)
 * @param {string} targetLanguage - Target language code (en, ja, fr, etc.)
 * @returns {Promise<{name: string, set: string, setNumber: string, rarity: string, language: string}>}
 */
export async function identifyCardFromBase64(base64Image, targetLanguage = 'en') {
    try {
        // Extract mime type and data from base64 string
        const matches = base64Image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) {
            throw new Error("Invalid base64 image format");
        }
        
        const mimeType = matches[1];
        const base64Data = matches[2];
        
        // IMPORTANT: Always ask for English name for database searching
        const prompt = `Identify this Pokémon card from the image. 

CRITICAL INSTRUCTIONS:
1. Return the card name in ENGLISH, even if the card is in Japanese, French, or any other language
2. For example: If you see "ピカチュウVMAX" → return "Pikachu VMAX"
3. If you see "リザードンex" → return "Charizard ex"
4. Detect the actual language of the physical card for the "language" field
5. Include all suffixes like V, VMAX, GX, EX, ex, etc. in English

Return ONLY a JSON object with these keys:
{
  "name": "Card name in ENGLISH (e.g., Pikachu VMAX)",
  "set": "Set name if visible (in English if possible)",
  "setNumber": "Card number (e.g., 001/100)",
  "rarity": "Rarity if visible",
  "language": "The actual language of the physical card (English/Japanese/French/etc)"
}

Do not include any other text, explanations, or markdown formatting. Return ONLY the JSON object.`;

        // FIXED: Changed from "gemini-1.5-pro-latest" to "gemini-1.5-flash"
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        
        // Prepare the image part
        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: mimeType
            }
        };
        
        // Generate content
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();
        
        if (!text) {
            throw new Error("No response from Gemini AI");
        }
        
        // Parse JSON from response (handle markdown code blocks if present)
        let jsonText = text.trim();
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        const cardInfo = JSON.parse(jsonText);
        
        if (!cardInfo.name) {
            throw new Error("AI did not identify a card name");
        }
        
        console.log("✅ AI Identified Card (English name):", cardInfo);
        return cardInfo;
        
    } catch (err) {
        console.error("Gemini identification error:", err);
        throw new Error(`AI identification failed: ${err.message}`);
    }
}

/**
 * Identifies a Pokémon card from a local file path (for file uploads)
 * @param {string} imagePath - The file path to the image of the Pokémon card.
 * @param {string} mimeType - The MIME type of the image (default 'image/jpeg').
 * @param {string} cardCondition - The condition of the card.
 * @returns {Promise<{name: string, set: string, setNumber: string, rarity: string, language: string} | null>}
 */
export async function identifyCardWithGemini(imagePath, mimeType = 'image/jpeg', cardCondition = 'unknown') {
    try {
        if (!fs.existsSync(imagePath)) {
            throw new Error(`File not found at path: ${imagePath}`);
        }

        const imageData = fs.readFileSync(imagePath).toString("base64");

        const prompt = `
Identify this Pokémon card from the image and return only a JSON object with the following keys:
- name (e.g., "Pikachu VMAX")
- set (e.g., "Sword & Shield")
- setNumber (the number printed on the card, e.g., "001" or "156/236")
- rarity (e.g., "Rare Holo")
- language (e.g., "English")
Do not include any other text, explanations, or markdown formatting.
`;

        // FIXED: Changed from "gemini-1.5-pro-latest" to "gemini-1.5-flash"
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const imagePart = {
            inlineData: {
                data: imageData,
                mimeType: mimeType
            }
        };

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const jsonText = response.text().trim();

        try {
            const cleanedJson = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            const cardInfo = JSON.parse(cleanedJson);
            cardInfo.condition = cardCondition;
            return cardInfo;
        } catch (e) {
            console.error("Failed to parse Gemini response:", jsonText);
            e.rawResponseText = jsonText;
            throw e;
        }

    } catch (err) {
        console.error("Failed to call Gemini or parse response:", err.message);
        if (err instanceof SyntaxError && err.rawResponseText) {
            console.error("Raw Gemini text response:", err.rawResponseText);
        }
        return null;
    }
}