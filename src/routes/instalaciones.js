const router = require('express').Router();
const pool = require('../../db');
const auth = require('../middleware/auth');

// Listar instalaciones con información de sucursal y empresa
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
    console.error('Error listando instalaciones:', e);
    res.status(500).json({ error: 'No se pudo listar instalaciones', detail: e.message });
  }
});

// Crear instalación con validación mejorada
router.post('/', auth, async (req, res) => {
  try {
    const {
      id_empresa_sucursal = 1,
      nombre_instalacion,
      descripcion = '',
    } = req.body || {};

    if (!nombre_instalacion || nombre_instalacion.trim().length === 0) {
      return res.status(400).json({ error: 'nombre_instalacion es obligatorio' });
    }

    // Verificar que la sucursal existe y está activa
    const [sucursalCheck] = await pool.query(
      `SELECT id_empresa_sucursal FROM empresa_sucursal 
       WHERE id_empresa_sucursal = ? AND estado_registro = 'activa' LIMIT 1`,
      [id_empresa_sucursal]
    );

    if (!sucursalCheck.length) {
      return res.status(400).json({ 
        error: `La sucursal con ID ${id_empresa_sucursal} no existe o no está activa` 
      });
    }

    const [ins] = await pool.query(
      `INSERT INTO instalacion (id_empresa_sucursal, nombre_instalacion, descripcion, fecha_creacion)
       VALUES (?, ?, ?, NOW())`,
      [id_empresa_sucursal, nombre_instalacion.trim(), descripcion]
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
    console.error('Error creando instalación:', e);
    if (e.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ 
        error: 'La sucursal especificada no existe. Verifica que haya sucursales activas.',
        detail: 'Ejecuta el script SQL para crear empresa y sucursal por defecto'
      });
    }
    res.status(500).json({ error: 'No se pudo crear la instalación', detail: e.message });
  }
});

// Listar sucursales disponibles para selector
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
    console.error('Error listando sucursales:', e);
    res.status(500).json({ error: 'No se pudo listar sucursales', detail: e.message });
  }
});

// Eliminar instalación (opcional)
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'ID de instalación inválido' });
    }

    const [result] = await pool.query(
      'DELETE FROM instalacion WHERE id_instalacion = ?',
      [parseInt(id)]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Instalación no encontrada' });
    }

    res.json({ message: 'Instalación eliminada correctamente' });
  } catch (e) {
    console.error('Error eliminando instalación:', e);
    res.status(500).json({ error: 'No se pudo eliminar la instalación', detail: e.message });
  }
});

// Obtener instalación por ID
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'ID de instalación inválido' });
    }

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
       WHERE i.id_instalacion = ?`, [parseInt(id)]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Instalación no encontrada' });
    }

    res.json(rows[0]);
  } catch (e) {
    console.error('Error obteniendo instalación:', e);
    res.status(500).json({ error: 'No se pudo obtener la instalación', detail: e.message });
  }
});

module.exports = router;
