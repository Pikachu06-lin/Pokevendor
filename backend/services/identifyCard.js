import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs'; 
import 'dotenv/config'; // Ensure environment variables are loaded for the API key

// Initialize the GoogleGenAI instance.
// It automatically picks up the GEMINI_API_KEY from process.env.
const ai = new GoogleGenAI({}); 

/**
 * Converts a local file path into the GenerativePart object required by the Gemini API.
 * @param {string} path The local path to the file saved by Multer.
 * @param {string} mimeType The MIME type of the file (e.g., 'image/jpeg', 'image/png').
 * @returns {{inlineData: {data: string, mimeType: string}}}
 */
function fileToGenerativePart(path, mimeType) {
  // Read the local file contents and convert the buffer to a Base64 string
  const fileData = fs.readFileSync(path).toString("base64");
  
  return {
    inlineData: {
      data: fileData,
      mimeType,
    },
  };
}

/**
 * Identifies a Pokémon card from a local image file using the Gemini API.
 * @param {string} imagePath The local file path where Multer saved the image.
 * @param {string} mimeType The MIME type of the uploaded file.
 * @param {string} condition The known condition of the card.
 * @returns {Promise<object | null>} A promise that resolves to the parsed JSON card object.
 */
export async function identifyCardWithGemini(imagePath, mimeType, condition = 'unknown') {
    
    // 1. Convert the local file into the required API format
    const imagePart = fileToGenerativePart(imagePath, mimeType);
    
    // 2. Adjust prompt to strictly enforce pure JSON output
    const prompt = `Identify this Pokémon card and return **only** a JSON object with the keys: "name", "set", "number", "rarity", and "language". The card condition is known to be '${condition}'. Do not include any other text, markdown formatting, or preamble.`;
    
    try {
        // 3. Call the Gemini API, including both the image part and the prompt
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { 
                    role: "user", 
                    parts: [
                        imagePart, 
                        { text: prompt }
                    ] 
                }
            ]
        });
        
        let jsonText = response.text.trim();
        
        // 4. Robust JSON Parsing: Strip markdown code block wrappers (```json...```)
        const jsonMatch = jsonText.match(/```json\s*([\s\S]*)\s*```/i);
        
        if (jsonMatch) {
            // Use the captured group (index 1) which contains the clean JSON string
            jsonText = jsonMatch[1].trim();
        } else {
            // Fallback: If no wrapper is found, ensure the string is still trimmed
            jsonText = jsonText.trim();
        }

        try {
            // Attempt to parse the cleaned JSON text
            const cardInfo = JSON.parse(jsonText);
            
            // Add the condition back to the object before returning
            return { ...cardInfo, condition }; 
        } catch (parseError) {
            // If parsing fails, log the raw text that failed and throw a descriptive error
            parseError.rawResponseText = jsonText;
            throw parseError; 
        }
        
    } catch (err) {
        // Log the error for debugging purposes
        console.error('Gemini AI error:', err);
        
        // Log the raw text if parsing failed
        if (err instanceof SyntaxError && err.rawResponseText) {
            console.error("Gemini Raw Response Text (Failed to Parse):", err.rawResponseText);
        }
        
        // Throw a user-friendly error that will be caught by cards.js
        throw new Error('Failed to identify card via Gemini AI'); 
    }
}