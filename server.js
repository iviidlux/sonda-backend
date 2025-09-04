import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

// Ruta de prueba
app.get('/api/health', async (_req, res) => {
  const [rows] = await pool.query('SELECT NOW() as ahora');
  res.json(rows[0]);
});

app.listen(process.env.PORT || 3000, () =>
  console.log(`API corriendo en http://localhost:${process.env.PORT || 3000}`)
);
