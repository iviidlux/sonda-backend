const router = require('express').Router();
const pool = require('../../db');
const auth = require('../middleware/auth');

// Listar instalaciones
router.get('/', auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
         i.id_instalacion,
         i.id_empresa_sucursal,
         i.nombre_instalacion as nombre,
         i.descripcion,
         i.fecha_creacion,
         es.nombre_sucursal,
         e.nombre as empresa_nombre
       FROM instalacion i
       JOIN empresa_sucursal es ON i.id_empresa_sucursal = es.id_empresa_sucursal
       JOIN empresa e ON es.id_empresa = e.id_empresa
       WHERE es.estado_registro = 'activa'
       ORDER BY i.id_instalacion DESC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo listar instalaciones', detail: e.message });
  }
});

// Crear instalación
router.post('/', auth, async (req, res) => {
  try {
    const {
      id_empresa_sucursal = 1, // Usar primera sucursal por defecto
      nombre_instalacion,
      descripcion = '',
    } = req.body || {};

    if (!nombre_instalacion) {
      return res.status(400).json({ error: 'nombre_instalacion es obligatorio' });
    }

    const [ins] = await pool.query(
      `INSERT INTO instalacion (id_empresa_sucursal, nombre_instalacion, descripcion, fecha_creacion)
       VALUES (?, ?, ?, NOW())`,
      [id_empresa_sucursal, nombre_instalacion, descripcion]
    );

    const [row] = await pool.query(
      `SELECT i.*, es.nombre_sucursal, e.nombre as empresa_nombre
       FROM instalacion i
       JOIN empresa_sucursal es ON i.id_empresa_sucursal = es.id_empresa_sucursal
       JOIN empresa e ON es.id_empresa = e.id_empresa
       WHERE i.id_instalacion = ?`, [ins.insertId]
    );
    
    res.status(201).json(row[0]);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo crear la instalación', detail: e.message });
  }
});

// Listar sucursales disponibles
router.get('/sucursales', auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT es.id_empresa_sucursal, es.nombre_sucursal, e.nombre as empresa_nombre
       FROM empresa_sucursal es
       JOIN empresa e ON es.id_empresa = e.id_empresa
       WHERE es.estado_registro = 'activa'
       ORDER BY e.nombre, es.nombre_sucursal`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo listar sucursales', detail: e.message });
  }
});

module.exports = router;
