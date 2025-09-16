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
    id_usuario_creador,
    nombre_instalacion,
    fecha_instalacion,   // 'YYYY-MM-DD'
    estado_operativo,    // 'activo' | 'inactivo'
    descripcion,
    tipo_uso             // 'acuicultura' | 'tratamiento' | 'otro'
  } = req.body || {};

  if (!id_usuario_creador || !nombre_instalacion || !fecha_instalacion || !estado_operativo || !tipo_uso) {
    return res.status(400).json({ error: 'Faltan campos obligatorios (id_usuario_creador, nombre_instalacion, fecha_instalacion, estado_operativo, tipo_uso)' });
  }

  try {
    // Validar FK usuario existe
    const [[usr]] = await pool.query('SELECT 1 ok FROM usuario WHERE id_usuario=?', [id_usuario_creador]);
    if (!usr) return res.status(400).json({ error: 'id_usuario_creador inválido' });

    const [ins] = await pool.query(
      `INSERT INTO instalacion
        (id_usuario_creador, nombre, fecha_instalacion, estado, uso, descripcion)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id_usuario_creador, nombre_instalacion, fecha_instalacion, estado_operativo, tipo_uso, descripcion || '']
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
