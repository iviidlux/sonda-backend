import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

// Si ya tienes un pool, puedes cambiar './db' por tu ruta real
let pool = null;
try {
  pool = require('./db'); // opcional si ya tienes db.js
} catch (_) {
  /* sin DB por ahora */
}

const app = express();

// Middlewares
app.use(helmet());
app.use(cors({ origin: '*'}));
app.use(express.json({ limit: '1mb' }));

// Ruta raíz (opcional, útil para verificar que está vivo)
app.get('/', (_req, res) => {
  res.status(200).send('SONDA API running');
});

// Healthcheck para Render
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Ping a base de datos (opcional; requiere ./db configurado)
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

// TODO: aquí monta tus rutas reales
// const usuarios = require('./routes/usuarios');
// app.use('/api/usuarios', usuarios);

const PORT = process.env.PORT || 3000;
// IMPORTANTE en Render: escuchar en 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API escuchando en http://0.0.0.0:${PORT}`);
});
