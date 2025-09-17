// src/routes/procesos.js
const router = require('express').Router();
const pool = require('../../db');
const auth = require('../middleware/auth');

router.post('/', auth, async (req, res) => {
  try {
    const { id_instalacion, nombre, descripcion = '' } = req.body || {};
    if (!id_instalacion || !nombre) {
      return res.status(400).json({ error: 'id_instalacion y nombre son obligatorios' });
    }
    const [ins] = await pool.query(
      `INSERT INTO proceso (id_instalacion, nombre, descripcion) VALUES (?, ?, ?)`,
      [id_instalacion, nombre, descripcion]
    );
    const [row] = await pool.query(`SELECT * FROM proceso WHERE id_proceso = ?`, [ins.insertId]);
    res.status(201).json(row[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear el proceso', detail: e.message });
  }
});

module.exports = router;
