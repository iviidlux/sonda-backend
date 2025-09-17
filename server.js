// server.js (CommonJS)
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

// Health & ping DB
app.get('/', (_req, res) => res.status(200).send('SONDA API running'));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Rutas
app.use('/auth', require('./src/routes/auth'));                    // registro / login
app.use('/api/instalaciones', require('./src/routes/instalaciones')); // CRUD instalaciones
app.use('/api/seed', require('./src/routes/seed'));                // crea datos mínimos para probar
app.use('/api/procesos', require('./src/routes/procesos'));


const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API escuchando en http://0.0.0.0:${PORT}`);
});
