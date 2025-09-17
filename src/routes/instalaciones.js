// src/routes/instalaciones.js
const router = require('express').Router();
const pool = require('../../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
         i.id_instalacion, i.id_usuario_creador, i.id_empresa,
         i.nombre, i.fecha_instalacion, i.estado, i.uso, i.descripcion
       FROM instalacion i
       ORDER BY i.id_instalacion DESC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo listar instalaciones', detail: e.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const id_usuario_creador = req.user?.id_usuario ?? null;
    const {
      id_empresa = null,
      nombre,
      fecha_instalacion,
      estado = 'activo',
      uso = 'acuicultura',
      descripcion = ''
    } = req.body || {};

    if (!nombre || !fecha_instalacion) {
      return res.status(400).json({ error: 'nombre y fecha_instalacion son obligatorios' });
    }

    const [ins] = await pool.query(
      `INSERT INTO instalacion
        (id_usuario_creador, id_empresa, nombre, fecha_instalacion, estado, uso, descripcion)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id_usuario_creador, id_empresa, nombre, fecha_instalacion, estado, uso, descripcion]
    );

    const [row] = await pool.query(`SELECT * FROM instalacion WHERE id_instalacion = ?`, [ins.insertId]);
    res.status(201).json(row[0]);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo crear la instalación', detail: e.message });
  }
});

module.exports = router;
