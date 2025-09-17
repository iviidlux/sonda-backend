// src/routes/instalaciones.js
const router = require('express').Router();
const pool = require('../../db');
const auth = require('../middleware/auth');

// Mapea filas a shape plano esperado por Flutter
function mapInst(r) {
  return {
    id: r.id_instalacion,
    id_usuario_creador: r.id_usuario_creador ?? null,
    id_empresa: r.id_empresa ?? r.id_empresa_sucursal ?? null,
    nombre: r.nombre ?? r.nombre_instalacion,
    fecha_instalacion: r.fecha_instalacion,
    estado: r.estado ?? r.estado_operativo,
    uso: r.uso ?? r.tipo_uso,
    descripcion: r.descripcion ?? ''
  };
}

// GET /api/instalaciones
router.get('/', auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
         i.id_instalacion,
         i.id_usuario_creador,
         i.id_empresa      AS id_empresa,
         i.id_empresa_sucursal,         -- por compat, si existiera
         i.nombre            AS nombre,
         i.nombre_instalacion,
         i.fecha_instalacion,
         i.estado            AS estado,
         i.estado_operativo,
         i.uso               AS uso,
         i.tipo_uso,
         i.descripcion
       FROM instalacion i
       ORDER BY i.id_instalacion DESC`
    );
    res.json(rows.map(mapInst));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo listar instalaciones', detail: e.message });
  }
});

// POST /api/instalaciones
router.post('/', auth, async (req, res) => {
  try {
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

    const id_usuario_creador = req.user?.id_usuario ?? null;

    const [ins] = await pool.query(
      `INSERT INTO instalacion
        (id_usuario_creador, id_empresa, nombre, fecha_instalacion, estado, uso, descripcion)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id_usuario_creador, id_empresa, nombre, fecha_instalacion, estado, uso, descripcion]
    );

    const [row] = await pool.query(`SELECT * FROM instalacion WHERE id_instalacion = ?`, [ins.insertId]);
    res.status(201).json(mapInst(row[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear la instalación', detail: e.message });
  }
});

module.exports = router;
