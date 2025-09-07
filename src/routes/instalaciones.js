// src/routes/instalaciones.js
const router = require('express').Router();
const pool = require('../../db');
const auth = require('../middleware/auth');

// GET /api/instalaciones
router.get('/', auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.id_instalacion, i.nombre_instalacion, i.fecha_instalacion,
              i.estado_operativo, i.descripcion, i.tipo_uso,
              i.id_empresa_sucursal, i.id_proceso
         FROM instalacion i
         ORDER BY i.id_instalacion DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron listar instalaciones', detail: e.message });
  }
});

// POST /api/instalaciones
router.post('/', auth, async (req, res) => {
  const {
    id_empresa_sucursal,
    id_proceso,
    nombre_instalacion,
    fecha_instalacion,   // 'YYYY-MM-DD'
    estado_operativo,    // 'activo' | 'inactivo'
    descripcion,
    tipo_uso             // 'acuicultura' | 'tratamiento' | 'otros'
  } = req.body || {};

  if (!id_empresa_sucursal || !id_proceso || !nombre_instalacion || !fecha_instalacion || !estado_operativo || !tipo_uso) {
    return res.status(400).json({ error: 'Faltan campos obligatorios (id_empresa_sucursal, id_proceso, nombre_instalacion, fecha_instalacion, estado_operativo, tipo_uso)' });
  }

  try {
    // Validar FKs existen
    const [[es]] = await pool.query('SELECT 1 ok FROM empresa_sucursal WHERE id_empresa_sucursal=?', [id_empresa_sucursal]);
    const [[pr]] = await pool.query('SELECT 1 ok FROM procesos WHERE id_proceso=?', [id_proceso]);
    if (!es) return res.status(400).json({ error: 'id_empresa_sucursal inválido' });
    if (!pr) return res.status(400).json({ error: 'id_proceso inválido' });

    const [ins] = await pool.query(
      `INSERT INTO instalacion
        (id_empresa_sucursal, nombre_instalacion, fecha_instalacion, estado_operativo, descripcion, tipo_uso, id_proceso)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id_empresa_sucursal, nombre_instalacion, fecha_instalacion, estado_operativo, descripcion || '', tipo_uso, id_proceso]
    );

    const [row] = await pool.query(
      `SELECT * FROM instalacion WHERE id_instalacion = ?`,
      [ins.insertId]
    );

    res.status(201).json(row[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear la instalación', detail: e.message });
  }
});

module.exports = router;
