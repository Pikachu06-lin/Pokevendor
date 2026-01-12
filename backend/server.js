// server.js
// Main server file supporting both TCGdex and JustTCG APIs - ES Module Version
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';


// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
//dotenv.config();

/*
Used for debugging
console.log('=== DOTENV LOADED ===');
console.log('Current directory:', __dirname);
console.log('GEMINI_API_KEY from process.env:', process.env.GEMINI_API_KEY);
console.log('All env keys:', Object.keys(process.env).filter(k => k.includes('GEMINI')));
console.log('==================');
*/
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from frontend folder (one level up from backend)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Import routes
// Import your existing TCGdex routes (keep these as-is)
// import tcgdexRoutes from './routes/tcgdex-routes.js'; // Your existing routes

// Import new JustTCG routes
import justtcgRoutes from './routes/justtcg-routes.js';

// Mount routes
// app.use('/api/tcgdex', tcgdexRoutes); // Your existing TCGdex routes (uncomment when ready)
app.use('/api/justtcg', justtcgRoutes); // New JustTCG routes

// Shared authentication endpoint (used by both)
app.post('/api/login', async (req, res) => {
  console.log('Login attempt received:', req.body); // Debug log
  try {
    const { email, password } = req.body;

    console.log('Checking credentials...'); // Debug log
    console.log('ENV Email:', process.env.ADMIN_EMAIL);
    console.log('ENV Pass exists:', !!process.env.ADMIN_PASS);

    // TODO: Replace with your actual authentication logic
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASS) {
      // Generate token (use JWT in production)
      const token = 'demo-token-' + Date.now();
      
      console.log('Login successful!'); // Debug log
      res.json({
        success: true,
        token: token,
        message: 'Login successful'
      });
    } else {
      console.log('Invalid credentials'); // Debug log
      res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// Shared inventory endpoint (used by both APIs)
app.post('/api/add-to-inventory', async (req, res) => {
  try {
    const { card, condition, language } = req.body;

    if (!card) {
      return res.status(400).json({ error: 'Card data is required' });
    }

    // TODO: Implement your inventory database logic here
    const inventoryItem = {
      ...card,
      condition: condition,
      language: language,
      addedAt: new Date().toISOString(),
      source: card.source || 'unknown' // Track which API was used
    };

    // Example: Save to database
    // await InventoryModel.create(inventoryItem);

    console.log('Adding to inventory:', inventoryItem);

    res.json({
      success: true,
      message: 'Card added to inventory successfully',
      item: inventoryItem
    });

  } catch (error) {
    console.error('Error adding to inventory:', error);
    res.status(500).json({ 
      error: 'Failed to add card to inventory',
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apis: {
      tcgdex: 'active',
      justtcg: process.env.JUSTTCG_API_KEY ? 'active' : 'not configured'
    },
    timestamp: new Date().toISOString()
  });
});

// Route to serve different upload pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')); // TCGdex page
});

app.get('/japanese', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'justtcg-upload.html')); // JustTCG page
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   🎴 PokéVendor Server Running                           ║
  ║                                                           ║
  ║   Port: ${PORT}                                             ║
  ║                                                           ║
  ║   English Cards (TCGdex):  http://localhost:${PORT}       ║
  ║   Japanese Cards (JustTCG): http://localhost:${PORT}/japanese  ║
  ║                                                           ║
  ║   API Status: http://localhost:${PORT}/api/health         ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `);
});