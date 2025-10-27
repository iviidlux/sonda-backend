require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_local_super_seguro';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'Mvergel',
  database: process.env.DB_NAME || 'aqua_sonda',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const authMiddleware = (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token inválido' });
  }
};

// Logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'aquasense-api' });
});

app.get('/debug/db-ping', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT 1 AS ok');
  res.json({ ok: rows[0].ok, db: 'aqua_sonda' });
}));

// AUTH
app.post(['/api/auth/register', '/auth/register'], asyncHandler(async (req, res) => {
  const { nombre_completo, correo, password, id_rol } = req.body;
  const nombre = nombre_completo || req.body.nombre;
  const idRol = id_rol || req.body.idRol || req.body.rol;
  
  if (!nombre || !correo || !password || !idRol) {
    return res.status(400).json({ message: 'Campos incompletos' });
  }

  const [roles] = await pool.query('SELECT id_rol FROM tipo_rol WHERE id_rol = ? OR nombre = ?', [idRol, idRol]);
  if (roles.length === 0) return res.status(400).json({ message: 'Rol inválido' });
  
  const [exist] = await pool.query('SELECT id_usuario FROM usuario WHERE correo = ?', [correo]);
  if (exist.length > 0) return res.status(409).json({ message: 'El correo ya existe' });

  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO usuario (id_rol, nombre_completo, correo, password_hash, activo) VALUES (?, ?, ?, ?, 1)`,
    [roles[0].id_rol, nombre, correo, hash]
  );

  const token = jwt.sign({ uid: result.insertId, correo }, JWT_SECRET, { expiresIn: '8h' });
  res.status(201).json({ message: 'Registrado', token, nombre, correo });
}));

app.post(['/api/auth/login', '/auth/login'], asyncHandler(async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) return res.status(400).json({ message: 'Campos incompletos' });

  const [rows] = await pool.query(
    `SELECT u.id_usuario, u.password_hash, u.activo, u.nombre_completo FROM usuario u WHERE u.correo = ?`,
    [correo]
  );

  if (rows.length === 0) return res.status(401).json({ message: 'Credenciales inválidas' });
  const u = rows[0];
  if (u.activo !== 1) return res.status(403).json({ message: 'Usuario inactivo' });

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ message: 'Credenciales inválidas' });

  const token = jwt.sign({ uid: u.id_usuario, correo }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, nombre: u.nombre_completo, correo });
}));

// =====================
// INSTALACIONES CON FILTROS POR USUARIO
// =====================

// GET - Solo instalaciones asignadas al usuario autenticado
app.get('/api/instalaciones', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  console.log('🔍 Listando instalaciones para usuario:', userId);
  
  if (!userId) return res.status(401).json({ message: 'No autenticado' });

  // Usar tabla asignacion_usuario para filtrar por usuario
  const [rows] = await pool.query(`
    SELECT 
      i.id_instalacion,
      i.nombre_instalacion AS nombre,
      COALESCE(i.descripcion, '') AS ubicacion,
      'activo' AS estado,
      COALESCE(COUNT(si.id_sensor_instalado), 0) AS sensores
    FROM instalacion i
    JOIN asignacion_usuario au ON au.id_instalacion = i.id_instalacion
    LEFT JOIN sensor_instalado si ON si.id_instalacion = i.id_instalacion
    WHERE au.id_usuario = ?
    GROUP BY i.id_instalacion, i.nombre_instalacion, i.descripcion
    ORDER BY i.nombre_instalacion ASC
  `, [userId]);
  
  console.log('✅ Instalaciones encontradas para usuario', userId + ':', rows.length);
  res.json(rows);
}));

// POST - Crear instalación Y asignarla al usuario
app.post('/api/instalaciones', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  console.log('📝 Creando instalación para usuario:', userId);
  
  if (!userId) return res.status(401).json({ message: 'No autenticado' });

  const {
    nombre,           
    name,            
    nombre_instalacion, 
    nombreInstalacion,  
    title,           
    descripcion,
    description,
    desc
  } = req.body || {};
  
  const finalNombre = nombre || name || nombre_instalacion || nombreInstalacion || title;
  const finalDescripcion = descripcion || description || desc || '';
  
  console.log('🏷️ Creando instalación:', finalNombre);
  
  if (!finalNombre || typeof finalNombre !== 'string' || finalNombre.trim().length === 0) {
    return res.status(400).json({ message: 'nombre requerido' });
  }

  try {
    // 1. Crear la instalación
    const [result] = await pool.query(
      `INSERT INTO instalacion (id_empresa_sucursal, nombre_instalacion, descripcion) VALUES (1, ?, ?)`,
      [finalNombre.trim(), finalDescripcion.toString()]
    );

    const instalacionId = result.insertId;
    console.log('✅ Instalación creada con ID:', instalacionId);

    // 2. Asignar la instalación al usuario que la creó
    await pool.query(
      `INSERT INTO asignacion_usuario (id_usuario, id_instalacion) VALUES (?, ?)`,
      [userId, instalacionId]
    );

    console.log('✅ Instalación asignada al usuario:', userId);

    // 3. Devolver la instalación creada
    const [rows] = await pool.query(
      `SELECT 
        i.id_instalacion AS id,
        i.nombre_instalacion AS nombre,
        COALESCE(i.descripcion, '') AS descripcion,
        'activo' AS estado,
        i.fecha_creacion AS fechaInstalacion
      FROM instalacion i WHERE i.id_instalacion = ?`,
      [instalacionId]
    );

    console.log('🎉 Instalación completa:', rows[0]);
    res.status(201).json(rows[0]);

  } catch (dbError) {
    console.error('❌ Error al crear instalación:', dbError.message);
    res.status(500).json({ 
      message: 'Error al crear instalación',
      error: dbError.message 
    });
  }
}));

// DELETE - Solo puede eliminar instalaciones asignadas a él
app.delete('/api/instalaciones/:id', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const instalacionId = Number(req.params.id) || 0;
  
  console.log('🗑️ Usuario', userId, 'intentando eliminar instalación', instalacionId);
  
  if (!userId) return res.status(401).json({ message: 'No autenticado' });
  if (!instalacionId) return res.status(400).json({ message: 'ID inválido' });

  // Verificar que la instalación esté asignada al usuario
  const [permisos] = await pool.query(
    `SELECT 1 FROM asignacion_usuario WHERE id_usuario = ? AND id_instalacion = ?`,
    [userId, instalacionId]
  );

  if (permisos.length === 0) {
    console.log('❌ Usuario sin permisos para eliminar instalación');
    return res.status(403).json({ message: 'Sin permiso para eliminar esta instalación' });
  }

  // Eliminar la asignación (soft delete)
  const [result] = await pool.query(
    `DELETE FROM asignacion_usuario WHERE id_usuario = ? AND id_instalacion = ?`,
    [userId, instalacionId]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Instalación no encontrada' });
  }

  console.log('✅ Instalación eliminada (asignación removida)');
  res.json({ ok: true, id: instalacionId, estado: 'eliminado' });
}));

// Sensores - Solo de instalaciones asignadas al usuario
app.get('/api/instalaciones/:id/sensores', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const instalacionId = Number(req.params.id) || 0;
  
  if (!userId) return res.status(401).json({ message: 'No autenticado' });
  if (!instalacionId) return res.status(400).json({ message: 'ID inválido' });

  // Verificar permisos
  const [permisos] = await pool.query(
    `SELECT 1 FROM asignacion_usuario WHERE id_usuario = ? AND id_instalacion = ?`,
    [userId, instalacionId]
  );

  if (permisos.length === 0) {
    return res.status(403).json({ message: 'Sin permiso para esta instalación' });
  }

  const [rows] = await pool.query(
    `SELECT 
      si.id_sensor_instalado,
      COALESCE(si.descripcion, 'Sensor sin nombre') AS nombre_sensor,
      'activo' AS estado,
      'Sensor genérico' AS tipo_sensor,
      'Sin unidad' AS unidad,
      'Sin lecturas' AS ultima_lectura
    FROM sensor_instalado si
    WHERE si.id_instalacion = ?
    ORDER BY si.id_sensor_instalado DESC`,
    [instalacionId]
  );

  res.json(rows);
}));

// Lecturas
app.get('/api/lecturas/resumen', asyncHandler(async (_req, res) => {
  res.json([]);
}));

// Debug
app.get('/whoami', (_req, res) => {
  const nets = os.networkInterfaces();
  let lanIP = '127.0.0.1';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        lanIP = net.address;
      }
    }
  }
  res.json({ lan: lanIP, time: new Date().toISOString() });
});

// =====================
// TAREAS PROGRAMADAS (CORREGIDO)
// =====================

// Listar tareas por instalación  
app.get('/api/tareas-programadas/:idInstalacion', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const idInstalacion = Number(req.params.idInstalacion) || 0;
  
  console.log('📋 Listando tareas para instalación:', idInstalacion, 'usuario:', userId);
  
  if (!userId) return res.status(401).json({ message: 'No autenticado' });
  if (!idInstalacion) return res.status(400).json({ message: 'ID de instalación inválido' });

  // Verificar que el usuario tenga acceso a la instalación
  const [permisos] = await pool.query(
    `SELECT 1 FROM asignacion_usuario WHERE id_usuario = ? AND id_instalacion = ?`,
    [userId, idInstalacion]
  );
  
  if (permisos.length === 0) {
    return res.status(403).json({ message: 'Sin permiso para esta instalación' });
  }

  // Buscar tareas programadas (NOMBRES CORRECTOS DE COLUMNAS)
  const [rows] = await pool.query(
    `SELECT 
      tp.id_tarea AS id,
      tp.nombre,
      'Sin descripción' AS descripcion,
      tp.tipo,
      tp.hora_inicio,
      tp.hora_fin,
      tp.activo,
      tp.creado
    FROM tarea_programada tp 
    WHERE tp.id_instalacion = ? 
    ORDER BY tp.creado DESC`,
    [idInstalacion]
  );

  console.log('✅ Tareas encontradas:', rows.length);
  res.json(rows);
}));

// Crear tarea programada
app.post('/api/tareas-programadas', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  
  if (!userId) return res.status(401).json({ message: 'No autenticado' });

  const {
    id_instalacion,
    nombre,
    tipo = 'horario',
    hora_inicio,
    hora_fin,
    oxigeno_min,
    oxigeno_max,
    duracion_minutos,
    accion = 'activar_aerador',
    activo = true
  } = req.body;
  
  console.log('📝 Creando tarea programada:', nombre);

  if (!id_instalacion || !nombre) {
    return res.status(400).json({ message: 'id_instalacion y nombre son requeridos' });
  }

  // Verificar permisos sobre la instalación
  const [permisos] = await pool.query(
    `SELECT 1 FROM asignacion_usuario WHERE id_usuario = ? AND id_instalacion = ?`,
    [userId, id_instalacion]
  );
  
  if (permisos.length === 0) {
    return res.status(403).json({ message: 'Sin permiso para esta instalación' });
  }

  const [result] = await pool.query(
    `INSERT INTO tarea_programada 
     (id_instalacion, nombre, tipo, hora_inicio, hora_fin, oxigeno_min, oxigeno_max, duracion_minutos, accion, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id_instalacion, nombre, tipo, hora_inicio, hora_fin, oxigeno_min, oxigeno_max, duracion_minutos, accion, activo ? 1 : 0]
  );

  const [rows] = await pool.query(
    `SELECT 
      tp.id_tarea AS id,
      tp.nombre,
      'Sin descripción' AS descripcion,
      tp.tipo,
      tp.hora_inicio,
      tp.hora_fin,
      tp.activo,
      tp.creado
    FROM tarea_programada tp 
    WHERE tp.id_tarea = ?`,
    [result.insertId]
  );

  console.log('✅ Tarea programada creada:', rows[0]);
  res.status(201).json(rows[0]);
}));

// Eliminar tarea programada
app.delete('/api/tareas-programadas/:id', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const tareaId = Number(req.params.id) || 0;
  
  if (!userId) return res.status(401).json({ message: 'No autenticado' });
  if (!tareaId) return res.status(400).json({ message: 'ID inválido' });

  console.log('🗑️ Eliminando tarea:', tareaId, 'usuario:', userId);

  // Verificar permisos (que la tarea pertenezca a una instalación del usuario)
  const [permisos] = await pool.query(
    `SELECT 1 FROM tarea_programada tp
     JOIN asignacion_usuario au ON au.id_instalacion = tp.id_instalacion
     WHERE tp.id_tarea = ? AND au.id_usuario = ?`,
    [tareaId, userId]
  );

  if (permisos.length === 0) {
    return res.status(403).json({ message: 'Sin permiso para eliminar esta tarea' });
  }

  const [result] = await pool.query(
    `DELETE FROM tarea_programada WHERE id_tarea = ?`,
    [tareaId]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Tarea no encontrada' });
  }

  console.log('✅ Tarea eliminada');
  res.json({ ok: true, id: tareaId });
}));


// 404
app.use((req, res) => {
  res.status(404).json({ message: 'Ruta no encontrada' });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('💥 ERROR:', err.message);
  res.status(500).json({ message: err.message || 'Error interno' });
});

// Start server
(async () => {
  try {
    const c = await pool.getConnection();
    await c.ping();
    c.release();
    console.log('✅ Conexión a MySQL establecida');
    
    const nets = os.networkInterfaces();
    let lanIP = '127.0.0.1';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          lanIP = net.address;
        }
      }
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log('🚀 API AquaSense con FILTROS POR USUARIO:');
      console.log(`   • Local: http://127.0.0.1:${PORT}`);
      console.log(`   • LAN:   http://${lanIP}:${PORT}`);
      console.log('   🔒 Cada usuario ve solo sus instalaciones');
      console.log('   📊 Instalaciones filtradas por tabla asignacion_usuario');
    });
  } catch (e) {
    console.error('❌ Error al conectar MySQL:', e.message);
    process.exit(1);
  }
})();
