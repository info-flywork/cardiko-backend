require('dotenv').config();

const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const cardsRoutes = require('./routes/cards');
const uploadsRoutes = require('./routes/uploads');
const aiRoutes = require('./routes/ai');
const meRoutes = require('./routes/me');
const templatesRoutes = require('./routes/templates');
const publicCardsRoutes = require('./routes/publicCards');
const publicSharesRoutes = require('./routes/publicShares');
const webhooksRoutes = require('./routes/webhooks');
const { uploadsDir } = require('./controller/uploadsController');
const { initDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.warn(
    '[warn] JWT_SECRET tanımlı değil — .env dosyasına ekleyin.'
  );
}

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return sendJson(body);
  };
  next();
});

app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Cardiko API',
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/me', meRoutes);
app.use('/templates', templatesRoutes);
app.use('/cards', cardsRoutes);
app.use('/c', publicCardsRoutes);
app.use('/s', publicSharesRoutes);
app.use('/uploads', uploadsRoutes);
app.use('/ai', aiRoutes);
app.use('/webhooks', webhooksRoutes);
app.use('/uploads', express.static(uploadsDir));

async function start() {
  try {
    await initDatabase();
    console.log('[db] MySQL bağlandı, tablolar hazır');
  } catch (err) {
    console.error('[db] Bağlantı / migrate hatası:', err.message);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();
