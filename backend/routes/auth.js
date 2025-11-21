import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  if (email !== process.env.ADMIN_EMAIL) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, await bcrypt.hash(process.env.ADMIN_PASS, 12));
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ email, role: 'admin' }, JWT_SECRET, { expiresIn: '6h' });
  res.json({ token, expiresIn: 6 * 3600 });
});

export default router;
