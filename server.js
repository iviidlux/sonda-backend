// server.js (CommonJS)
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

let pool = null;
try {
  pool = require('./db'); // si no tienes db.js aún, no pasa nada
} catch (_) {
  /* sin DB por ahora */
}

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => res.status(200).send('SONDA API running'));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.get('/api/ping-db', async (_req, res) => {
  if (!pool) return res.json({ db: 'not-configured' });
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ db: rows[0].ok === 1 ? 'up' : 'down' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB connection failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API escuchando en http://0.0.0.0:${PORT}`);
});
