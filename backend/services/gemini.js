export async function identifyCardWithGemini(imagePath) {
  const imageBytes = fs.readFileSync(imagePath, { encoding: "base64" });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        parts: [
          {
            text: "Identify this Pokémon card and return JSON with name, set, number, rarity, language"
          },
          {
            image: imageBytes
          }
        ]
      }
    ]
  });

  try {
    return JSON.parse(response.contents[0].text);
  } catch (err) {
    console.error("Failed to parse Gemini response as JSON:", response.contents[0].text);
    return null;
  }
}
