const router = require('express').Router();
const pool = require('../../db');
const auth = require('../middleware/auth');

// Listar tareas programadas por instalación
router.get('/:id_instalacion', auth, async (req, res) => {
  try {
    const { id_instalacion } = req.params;
    
    if (!id_instalacion || isNaN(parseInt(id_instalacion))) {
      return res.status(400).json({ error: 'ID de instalación inválido' });
    }

    // Verificar que la instalación existe
    const [instalacion] = await pool.query(
      'SELECT id_instalacion FROM instalacion WHERE id_instalacion = ?',
      [parseInt(id_instalacion)]
    );

    if (!instalacion.length) {
      return res.status(404).json({ error: 'Instalación no encontrada' });
    }

    // Si existe tabla tareas_programadas, usar esa consulta
    const [tareas] = await pool.query(
      `SELECT 
         tp.id_tarea_programada as id,
         tp.nombre_tarea as nombre,
         tp.descripcion,
         tp.fecha_programada,
         tp.hora_programada,
         tp.estado,
         tp.tipo_tarea,
         tp.parametros_json,
         tp.fecha_creacion,
         tp.fecha_completada
       FROM tareas_programadas tp
       WHERE tp.id_instalacion = ?
       ORDER BY tp.fecha_programada ASC, tp.hora_programada ASC`,
      [parseInt(id_instalacion)]
    );

    res.json(tareas);
  } catch (e) {
    console.error('Error obteniendo tareas programadas:', e);
    
    // Si la tabla no existe, devolver array vacío
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return res.json([]);
    }
    
    res.status(500).json({ 
      error: 'No se pudieron obtener las tareas programadas', 
      detail: e.message 
    });
  }
});

// Crear tarea programada
router.post('/', auth, async (req, res) => {
  try {
    const {
      id_instalacion,
      nombre_tarea,
      descripcion = '',
      fecha_programada,
      hora_programada,
      tipo_tarea = 'manual',
      parametros_json = null,
    } = req.body || {};

    if (!id_instalacion || !nombre_tarea || !fecha_programada || !hora_programada) {
      return res.status(400).json({ 
        error: 'id_instalacion, nombre_tarea, fecha_programada y hora_programada son obligatorios' 
      });
    }

    const [result] = await pool.query(
      `INSERT INTO tareas_programadas 
        (id_instalacion, nombre_tarea, descripcion, fecha_programada, hora_programada, 
         tipo_tarea, parametros_json, estado, fecha_creacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', NOW())`,
      [id_instalacion, nombre_tarea, descripcion, fecha_programada, hora_programada, 
       tipo_tarea, parametros_json]
    );

    const [nuevaTarea] = await pool.query(
      'SELECT * FROM tareas_programadas WHERE id_tarea_programada = ?',
      [result.insertId]
    );

    res.status(201).json(nuevaTarea[0]);
  } catch (e) {
    console.error('Error creando tarea programada:', e);
    
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return res.status(501).json({ 
        error: 'Funcionalidad no disponible: tabla tareas_programadas no existe' 
      });
    }
    
    res.status(500).json({ 
      error: 'No se pudo crear la tarea programada', 
      detail: e.message 
    });
  }
});

// Actualizar estado de tarea
router.patch('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body || {};

    if (!estado || !['pendiente', 'completada', 'cancelada'].includes(estado)) {
      return res.status(400).json({ 
        error: 'Estado debe ser: pendiente, completada o cancelada' 
      });
    }

    const fechaCompletada = estado === 'completada' ? 'NOW()' : 'NULL';
    
    const [result] = await pool.query(
      `UPDATE tareas_programadas 
       SET estado = ?, fecha_completada = ${fechaCompletada}
       WHERE id_tarea_programada = ?`,
      [estado, parseInt(id)]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }

    res.json({ message: 'Tarea actualizada correctamente' });
  } catch (e) {
    console.error('Error actualizando tarea:', e);
    res.status(500).json({ 
      error: 'No se pudo actualizar la tarea', 
      detail: e.message 
    });
  }
});

module.exports = router;
