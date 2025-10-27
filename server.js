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

// ===== Config =====
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_local_super_seguro';

// >>> MySQL local (o usa .env)
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'Mvergel',
  database: process.env.DB_NAME || 'aqua_sonda', // Usar el nombre correcto de tu DB
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

// ===== util =====
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ===== Auth middleware (JWT) =====
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

// ===== logger simple =====
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ===== health =====
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'aquasense-api',
    endpoints: [
      '/debug/db-ping',
      '/api/instalaciones (GET/POST)',
      '/api/instalaciones/:id/sensores',
      '/api/lecturas/resumen',
    ],
  });
});

app.get('/debug/db-ping', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT 1 AS ok');
  res.json({ ok: rows[0].ok, db: 'aqua_sonda' });
}));

// =====================
// AUTH (USANDO COLUMNA ACTIVO)
// =====================
app.post(['/api/auth/register', '/auth/register'], asyncHandler(async (req, res) => {
  const { nombre_completo, correo, password, id_rol, telefono } = req.body;
  
  const nombre = nombre_completo || req.body.nombre;
  const idRol = id_rol || req.body.idRol || req.body.rol;
  
  if (!nombre || !correo || !password || !idRol) {
    return res.status(400).json({ message: 'Campos incompletos' });
  }

  const [roles] = await pool.query('SELECT id_rol FROM tipo_rol WHERE id_rol = ? OR nombre = ?', [idRol, idRol]);
  if (roles.length === 0) return res.status(400).json({ message: 'Rol inválido' });
  const finalIdRol = roles[0].id_rol;

  const [exist] = await pool.query('SELECT id_usuario FROM usuario WHERE correo = ?', [correo]);
  if (exist.length > 0) return res.status(409).json({ message: 'El correo ya existe' });

  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO usuario (id_rol, nombre_completo, correo, password_hash, activo)
     VALUES (?, ?, ?, ?, 1)`,
    [finalIdRol, nombre, correo, hash]
  );

  const [roleData] = await pool.query('SELECT nombre FROM tipo_rol WHERE id_rol = ?', [finalIdRol]);
  const rolNombre = roleData[0]?.nombre || 'usuario';

  const token = jwt.sign({ uid: result.insertId, correo, rol: rolNombre }, JWT_SECRET, { expiresIn: '8h' });
  res.status(201).json({ message: 'Registrado', token, nombre, rol: rolNombre, correo });
}));

app.post(['/api/auth/login', '/auth/login'], asyncHandler(async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) return res.status(400).json({ message: 'Campos incompletos' });

  const [rows] = await pool.query(
    `SELECT u.id_usuario, u.password_hash, u.activo, r.nombre AS rol, u.nombre_completo
       FROM usuario u
       JOIN tipo_rol r ON r.id_rol = u.id_rol
      WHERE u.correo = ?`,
    [correo]
  );

  if (rows.length === 0) return res.status(401).json({ message: 'Credenciales inválidas' });
  const u = rows[0];
  if (u.activo !== 1) return res.status(403).json({ message: 'Usuario inactivo' });

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ message: 'Credenciales inválidas' });

  const token = jwt.sign({ uid: u.id_usuario, rol: u.rol, correo }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, nombre: u.nombre_completo, rol: u.rol, correo });
}));

// =====================
// INSTALACIONES (ADAPTADAS A TU SCHEMA REAL)
// =====================

// Listado de instalaciones - usando tabla asignacion_usuario para filtrar por usuario
app.get('/api/instalaciones', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  if (!userId) return res.status(401).json({ message: 'No autenticado' });

  const [rows] = await pool.query(
    `SELECT 
        i.id_instalacion,
        i.nombre_instalacion AS nombre,
        COALESCE(NULLIF(i.descripcion,''), '') AS ubicacion,
        'activo' AS estado,
        COALESCE(COUNT(si.id_sensor_instalado), 0) AS sensores
     FROM instalacion i
     JOIN asignacion_usuario au ON au.id_instalacion = i.id_instalacion
     LEFT JOIN sensor_instalado si ON si.id_instalacion = i.id_instalacion
     WHERE au.id_usuario = ?
     GROUP BY i.id_instalacion, i.nombre_instalacion, i.descripcion
     ORDER BY i.nombre_instalacion ASC`,
    [userId]
  );
  res.json(rows);
}));

// Crear instalación
app.post('/api/instalaciones', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  if (!userId) return res.status(401).json({ message: 'No autenticado' });

  const {
    nombre,
    id_empresa_sucursal = 1, // Usar sucursal por defecto
    descripcion = ''
  } = req.body || {};

  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
    return res.status(400).json({ message: 'nombre requerido' });
  }

  // Insertar instalación
  const [result] = await pool.query(
    `INSERT INTO instalacion (id_empresa_sucursal, nombre_instalacion, descripcion)
     VALUES (?, ?, ?)`,
    [id_empresa_sucursal, nombre.trim(), descripcion || '']
  );

  // Asignar instalación al usuario que la creó
  await pool.query(
    `INSERT INTO asignacion_usuario (id_usuario, id_instalacion)
     VALUES (?, ?)`,
    [userId, result.insertId]
  );

  // Devolver la instalación creada
  const [rows] = await pool.query(
    `SELECT 
        i.id_instalacion AS id,
        i.nombre_instalacion AS nombre,
        COALESCE(NULLIF(i.descripcion,''), '') AS descripcion,
        'activo' AS estado,
        i.fecha_creacion AS fechaInstalacion,
        'acuicultura' AS uso,
        ? AS idUsuarioCreador,
        i.id_empresa_sucursal AS idEmpresa
     FROM instalacion i
     WHERE i.id_instalacion = ?`,
    [userId, result.insertId]
  );

  res.status(201).json(rows[0]);
}));

// Eliminar instalación (soft delete simulado - remover asignación)
app.delete('/api/instalaciones/:id', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const id = Number(req.params.id) || 0;
  if (!userId) return res.status(401).json({ message: 'No autenticado' });
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  // Verificar permisos
  const [perm] = await pool.query(
    `SELECT 1 FROM asignacion_usuario WHERE id_usuario = ? AND id_instalacion = ?`,
    [userId, id]
  );
  if (perm.length === 0) return res.status(403).json({ message: 'Sin permiso para eliminar esta instalación' });

  // Remover asignación (soft delete)
  const [result] = await pool.query(
    `DELETE FROM asignacion_usuario WHERE id_usuario = ? AND id_instalacion = ?`,
    [userId, id]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Instalación no encontrada' });
  }
  res.json({ ok: true, id, estado: 'eliminado' });
}));

// Sensores por instalación
app.get('/api/instalaciones/:id/sensores', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const id = Number(req.params.id) || 0;
  if (!userId) return res.status(401).json({ message: 'No autenticado' });
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  // Verificar permisos
  const [perm] = await pool.query(
    `SELECT 1 FROM asignacion_usuario WHERE id_usuario = ? AND id_instalacion = ?`,
    [userId, id]
  );
  if (perm.length === 0) return res.status(403).json({ message: 'Sin permiso para esta instalación' });

  const [rows] = await pool.query(
    `SELECT 
        si.id_sensor_instalado,
        COALESCE(si.descripcion, CONCAT('Sensor ', si.id_sensor_instalado)) AS nombre_sensor,
        'activo' AS estado,
        cs.nombre AS tipo_sensor,
        cs.unidad AS unidad,
        'Sin lecturas' AS ultima_lectura
     FROM sensor_instalado si
     LEFT JOIN catalogo_sensores cs ON cs.id_sensor = si.id_sensor
     WHERE si.id_instalacion = ?
     ORDER BY si.id_sensor_instalado DESC`,
    [id]
  );

  res.json(rows);
}));

// =====================
// LECTURAS RESUMIDAS
// =====================
app.get('/api/lecturas/resumen', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT 
        NULL AS id_resumen,
        rlh.id_sensor_instalado,
        DATE(rlh.fecha_hora) AS fecha,
        TIME(rlh.fecha_hora) AS hora,
        rlh.avg_val AS promedio,
        rlh.cnt AS registros
     FROM resumen_lectura_horaria rlh
     ORDER BY rlh.fecha_hora DESC
     LIMIT 20`
  );
  res.json(rows);
}));

// ===== whoami (debug) =====
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
  res.json({
    file: __filename,
    cwd: process.cwd(),
    lan: lanIP,
    time: new Date().toISOString(),
  });
});

// 404
app.use((req, res) => {
  console.warn(`404 -> ${req.method} ${req.url}`);
  res.status(404).json({ message: 'Ruta no encontrada' });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('ERROR:', {
    code: err.code,
    message: err.message,
    stack: err.stack?.split('\n').slice(0, 2).join(' | '),
  });
  if (err.code) {
    return res.status(500).json({ message: err.message, code: err.code });
  }
  res.status(500).json({ message: err.message || 'Error interno' });
});

// start + ping inicial
(async () => {
  try {
    const c = await pool.getConnection();
    await c.ping();
    c.release();

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
      console.log('✅ API corriendo en:');
      console.log(`   • Local: http://127.0.0.1:${PORT}`);
      console.log(`   • LAN:   http://${lanIP}:${PORT}`);
      console.log('   ✨ Adaptado a tu schema de base de datos');
    });
  } catch (e) {
    console.error('❌ No se pudo conectar a MySQL:', e.code, e.message);
    process.exit(1);
  }
})();
