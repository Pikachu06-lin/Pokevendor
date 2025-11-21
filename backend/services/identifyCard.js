import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function identifyCardWithGemini(base64Image, condition = 'unknown') {
  try {
    const prompt = `Identify this Pokémon card and provide its name, set, number, rarity, and language. Card condition: ${condition}`;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [{ text: prompt }] }]
    });
    // Parse JSON from AI if you formatted response as JSON
    return JSON.parse(response.text || '{}');
  } catch (err) {
    console.error('Gemini AI error:', err);
    throw new Error('Failed to identify card via Gemini AI');
  }
}
