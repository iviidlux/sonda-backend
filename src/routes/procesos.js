// src/routes/procesos.js
const router = require('express').Router();
const pool = require('../../db');
const auth = require('../middleware/auth');

// Crear proceso
router.post('/', auth, async (req, res) => {
  try {
    const {
      id_instalacion,
      id_especie,
      fecha_inicio,             // 'YYYY-MM-DD' (obligatoria)
      fecha_final = null,       // opcional
      estado = 'activo',        // ENUM('activo','finalizado','pausado')
      notas = null,
    } = req.body || {};

    if (!id_instalacion || !id_especie || !fecha_inicio) {
      return res.status(400).json({ error: 'id_instalacion, id_especie y fecha_inicio son obligatorios' });
    }

    const [ins] = await pool.query(
      `INSERT INTO procesos
        (id_instalacion, id_especie, fecha_inicio, fecha_final, estado, notas)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id_instalacion, id_especie, fecha_inicio, fecha_final, estado, notas]
    );

    const [row] = await pool.query(`SELECT * FROM procesos WHERE id_proceso = ?`, [ins.insertId]);
    res.status(201).json(row[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear el proceso', detail: e.message });
  }
});

// (opcional) listar por instalación
router.get('/por-instalacion/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT p.*, e.nombre_comun AS especie
       FROM procesos p
       JOIN catalogo_especies e ON e.id_especie = p.id_especie
       WHERE p.id_instalacion = ?
       ORDER BY p.id_proceso DESC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo listar procesos', detail: e.message });
  }
});

module.exports = router;
