const fs = require('fs');
const { OpenAI } = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function identifyCardWithOpenAI(imagePath) {
  try {
    const imageData = fs.readFileSync(imagePath);

    const response = await client.images.analyze({
      model: "gpt-image-1",
      image: imageData,
    });

    // The response will include text description and any detected objects
    // For now we return the text description
    return {
      description: response.data[0].text || "",
    };
  } catch (err) {
    console.error("OpenAI Vision error:", err);
    return null;
  }
}

module.exports = { identifyCardWithOpenAI };
