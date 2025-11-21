const tesseract = require('node-tesseract-ocr');

const config = {
  lang: "eng",
  oem: 1,
  psm: 3
};

async function runOCR(filePath) {
  try {
    const text = await tesseract.recognize(filePath, config);
    // cleanup: collapse whitespace and keep newlines
    const cleaned = text.replace(/\r/g, '\n').replace(/[^\S\r\n]+/g, ' ').trim();
    return cleaned;
  } catch (err) {
    console.error('OCR error:', err);
    throw err;
  }
}

module.exports = { runOCR };
