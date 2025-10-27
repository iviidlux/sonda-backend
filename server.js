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
  database: process.env.DB_NAME || 'u889902058_sonda0109_local',
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
    const decoded = jwt.verify(token, JWT_SECRET); // { uid, rol, correo }
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
      '/api/instalaciones/ping',
    ],
  });
});

app.get('/debug/db-ping', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT 1 AS ok');
  res.json({ ok: rows[0].ok, db: (process.env.DB_NAME || 'u889902058_sonda0109_local') });
}));

app.get('/api/instalaciones/ping', (_req, res) => {
  res.json({ ok: true, route: '/api/instalaciones/ping' });
});

// =====================
// AUTH
// =====================
app.post(['/api/auth/register', '/auth/register'], asyncHandler(async (req, res) => {
  const { nombre_completo, correo, password, id_rol, telefono } = req.body;
  
  // Mapeamos los parámetros que puede enviar el cliente Flutter
  const nombre = nombre_completo || req.body.nombre;
  const idRol = id_rol || req.body.idRol || req.body.rol;
  
  if (!nombre || !correo || !password || !idRol) {
    return res.status(400).json({ message: 'Campos incompletos' });
  }

  // Verificar que el rol existe
  const [roles] = await pool.query('SELECT id_rol FROM tipo_rol WHERE id_rol = ? OR nombre = ?', [idRol, idRol]);
  if (roles.length === 0) return res.status(400).json({ message: 'Rol inválido' });
  const finalIdRol = roles[0].id_rol;

  const [exist] = await pool.query('SELECT id_usuario FROM usuario WHERE correo = ?', [correo]);
  if (exist.length > 0) return res.status(409).json({ message: 'El correo ya existe' });

  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    `INSERT INTO usuario (id_rol, nombre_completo, correo, telefono, password_hash, estado)
     VALUES (?, ?, ?, ?, ?, 'activo')`,
    [finalIdRol, nombre, correo, telefono || null, hash]
  );

  // Obtener el rol nombre para el token
  const [roleData] = await pool.query('SELECT nombre FROM tipo_rol WHERE id_rol = ?', [finalIdRol]);
  const rolNombre = roleData[0]?.nombre || 'usuario';

  const token = jwt.sign({ uid: result.insertId, correo, rol: rolNombre }, JWT_SECRET, { expiresIn: '8h' });
  res.status(201).json({ message: 'Registrado', token, nombre, rol: rolNombre, correo });
}));

app.post(['/api/auth/login', '/auth/login'], asyncHandler(async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) return res.status(400).json({ message: 'Campos incompletos' });

  const [rows] = await pool.query(
    `SELECT u.id_usuario, u.password_hash, u.estado, r.nombre AS rol, u.nombre_completo
       FROM usuario u
       JOIN tipo_rol r ON r.id_rol = u.id_rol
      WHERE u.correo = ?`,
    [correo]
  );

  if (rows.length === 0) return res.status(401).json({ message: 'Credenciales inválidas' });
  const u = rows[0];
  if (u.estado !== 'activo') return res.status(403).json({ message: 'Usuario inactivo' });

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ message: 'Credenciales inválidas' });

  const token = jwt.sign({ uid: u.id_usuario, rol: u.rol, correo }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, nombre: u.nombre_completo, rol: u.rol, correo });
}));

// Cambiar contraseña
app.post(['/api/auth/change-password', '/auth/change-password'], asyncHandler(async (req, res) => {
  const { correo, currentPassword, newPassword } = req.body;
  if (!correo || !currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Campos incompletos' });
  }

  const [rows] = await pool.query(
    `SELECT id_usuario, password_hash, estado
       FROM usuario
      WHERE correo = ?`,
    [correo]
  );
  if (rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
  const u = rows[0];
  if (u.estado !== 'activo') return res.status(403).json({ message: 'Usuario inactivo' });

  const ok = await bcrypt.compare(currentPassword, u.password_hash);
  if (!ok) return res.status(401).json({ message: 'Contraseña actual incorrecta' });

  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE usuario SET password_hash = ? WHERE id_usuario = ?', [newHash, u.id_usuario]);
  res.json({ message: 'Contraseña actualizada' });
}));

// =====================
// HOME: Lecturas resumidas
// =====================
app.get('/api/lecturas/resumen', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT r.id_resumen, r.id_sensor_instalado, r.fecha, r.hora, r.promedio, r.registros
       FROM resumen_lectura_horaria r
      ORDER BY r.fecha DESC, r.hora DESC
      LIMIT 20`
  );
  res.json(rows);
}));

// =====================
// INSTALACIONES (FILTRADAS POR USUARIO)
// =====================

// Listado de instalaciones filtrado por usuario autenticado
app.get('/api/instalaciones', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  if (!userId) return res.status(401).json({ message: 'No autenticado' });

  const [rows] = await pool.query(
    `SELECT 
        i.id_instalacion,
        i.nombre_instalacion AS nombre,
        COALESCE(NULLIF(i.descripcion,''), '') AS ubicacion,
        i.estado_operativo AS estado,
        COALESCE(COUNT(si.id_sensor_instalado), 0) AS sensores
       FROM instalacion i
  LEFT JOIN sensor_instalado si ON si.id_instalacion = i.id_instalacion
      WHERE COALESCE(i.estado_operativo, 'activo') <> 'eliminado'
        AND (
             i.id_usuario_creador = ? 
             OR EXISTS (
               SELECT 1 
                 FROM usuario u 
                WHERE u.id_usuario = ? 
                  AND u.id_empresa IS NOT NULL 
                  AND u.id_empresa = i.id_empresa
             )
        )
   GROUP BY i.id_instalacion, i.nombre_instalacion, i.descripcion, i.estado_operativo
   ORDER BY i.nombre_instalacion ASC`,
    [userId, userId]
  );
  res.json(rows);
}));

// Crear instalación (asigna al usuario creador y opcionalmente a su empresa)
app.post('/api/instalaciones', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  if (!userId) return res.status(401).json({ message: 'No autenticado' });

  const {
    nombre,
    id_empresa,          // opcional desde el cliente
    fecha_instalacion,   // opcional; si no viene, hoy
    estado = 'activo',
    uso = 'acuicultura',
    descripcion = ''
  } = req.body || {};

  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
    return res.status(400).json({ message: 'nombre requerido' });
  }

  // Obtener empresa del usuario si no se especifica
  let idEmpresa = id_empresa;
  if (!idEmpresa) {
    const [urows] = await pool.query(
      'SELECT id_empresa FROM usuario WHERE id_usuario = ? LIMIT 1',
      [userId]
    );
    idEmpresa = urows.length ? urows[0].id_empresa : null;
  }

  // Fecha por defecto hoy
  const fechaFinal = fecha_instalacion || new Date().toISOString().slice(0,10); // yyyy-MM-dd

  // Inserta usando las columnas reales de tu tabla
  const [result] = await pool.query(
    `INSERT INTO instalacion
       (id_usuario_creador, id_empresa, nombre_instalacion, descripcion, estado_operativo, fecha_instalacion, tipo_uso)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      idEmpresa,
      nombre.trim(),
      descripcion || '',
      estado || 'activo',
      fechaFinal,
      uso || 'acuicultura'
    ]
  );

  // Devolver la instalación creada en el formato esperado por el cliente
  const [rows] = await pool.query(
    `SELECT 
        i.id_instalacion AS id,
        i.nombre_instalacion AS nombre,
        COALESCE(NULLIF(i.descripcion,''), '') AS descripcion,
        i.estado_operativo AS estado,
        i.fecha_instalacion AS fechaInstalacion,
        i.tipo_uso AS uso,
        i.id_usuario_creador AS idUsuarioCreador,
        i.id_empresa AS idEmpresa
     FROM instalacion i
    WHERE i.id_instalacion = ?`,
    [result.insertId]
  );

  res.status(201).json(rows[0]);
}));

// Eliminación suave de instalación (marca estado_operativo='eliminado')
app.delete('/api/instalaciones/:id', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const id = Number(req.params.id) || 0;
  if (!userId) return res.status(401).json({ message: 'No autenticado' });
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  // Verificar que la instalación pertenezca al usuario
  const [perm] = await pool.query(
    `SELECT 1 FROM instalacion i
     LEFT JOIN usuario u ON u.id_usuario = ?
     WHERE i.id_instalacion = ?
       AND (i.id_usuario_creador = ? OR (u.id_empresa IS NOT NULL AND u.id_empresa = i.id_empresa))
     LIMIT 1`,
    [userId, id, userId]
  );
  if (perm.length === 0) return res.status(403).json({ message: 'Sin permiso para eliminar esta instalación' });

  const [result] = await pool.query(
    `UPDATE instalacion SET estado_operativo = 'eliminado' WHERE id_instalacion = ?`,
    [id]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Instalación no encontrada' });
  }
  res.json({ ok: true, id, estado: 'eliminado' });
}));

// =====================
// TAREAS PROGRAMADAS (AERADOR)
// =====================

// Listar tareas por instalación
app.get('/api/tareas-programadas/:idInstalacion', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const idInstalacion = Number(req.params.idInstalacion) || 0;
  if (!userId) return res.status(401).json({ message: 'No autenticado' });

  // Verificar permisos sobre la instalación
  const [perm] = await pool.query(
    `SELECT 1 FROM instalacion i
     LEFT JOIN usuario u ON u.id_usuario = ?
     WHERE i.id_instalacion = ?
       AND (i.id_usuario_creador = ? OR (u.id_empresa IS NOT NULL AND u.id_empresa = i.id_empresa))
     LIMIT 1`,
    [userId, idInstalacion, userId]
  );
  if (perm.length === 0) return res.status(403).json({ message: 'Sin permiso para esta instalación' });

  const [rows] = await pool.query(
    `SELECT * FROM tarea_programada WHERE id_instalacion = ? ORDER BY creado DESC`,
    [idInstalacion]
  );
  res.json(rows);
}));

// Crear tarea programada
app.post('/api/tareas-programadas', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  if (!userId) return res.status(401).json({ message: 'No autenticado' });

  const {
    id_instalacion,
    nombre,
    tipo,
    hora_inicio,
    hora_fin,
    oxigeno_min,
    oxigeno_max,
    duracion_minutos,
    accion,
    activo
  } = req.body;
  
  if (!id_instalacion || !nombre || !accion) {
    return res.status(400).json({ message: 'Campos requeridos faltantes' });
  }

  // Verificar permisos sobre la instalación
  const [perm] = await pool.query(
    `SELECT 1 FROM instalacion i
     LEFT JOIN usuario u ON u.id_usuario = ?
     WHERE i.id_instalacion = ?
       AND (i.id_usuario_creador = ? OR (u.id_empresa IS NOT NULL AND u.id_empresa = i.id_empresa))
     LIMIT 1`,
    [userId, id_instalacion, userId]
  );
  if (perm.length === 0) return res.status(403).json({ message: 'Sin permiso para esta instalación' });

  const [result] = await pool.query(
    `INSERT INTO tarea_programada
      (id_instalacion, nombre, tipo, hora_inicio, hora_fin, oxigeno_min, oxigeno_max, duracion_minutos, accion, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id_instalacion, nombre, tipo || 'horario', hora_inicio, hora_fin, oxigeno_min, oxigeno_max, duracion_minutos, accion, activo ? 1 : 0]
  );
  const [rows] = await pool.query('SELECT * FROM tarea_programada WHERE id_tarea = ?', [result.insertId]);
  res.status(201).json(rows[0]);
}));

// Editar tarea programada
app.put('/api/tareas-programadas/:id', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const id = Number(req.params.id) || 0;
  if (!userId) return res.status(401).json({ message: 'No autenticado' });
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  // Verificar permisos sobre la tarea (a través de la instalación)
  const [perm] = await pool.query(
    `SELECT 1 FROM tarea_programada tp
     JOIN instalacion i ON i.id_instalacion = tp.id_instalacion
     LEFT JOIN usuario u ON u.id_usuario = ?
     WHERE tp.id_tarea = ?
       AND (i.id_usuario_creador = ? OR (u.id_empresa IS NOT NULL AND u.id_empresa = i.id_empresa))
     LIMIT 1`,
    [userId, id, userId]
  );
  if (perm.length === 0) return res.status(403).json({ message: 'Sin permiso para esta tarea' });

  const fields = req.body;
  const sets = [];
  const vals = [];
  for (const k of Object.keys(fields)) {
    sets.push(`${k} = ?`);
    vals.push(fields[k]);
  }
  if (sets.length === 0) return res.status(400).json({ message: 'Nada que actualizar' });
  vals.push(id);
  await pool.query(`UPDATE tarea_programada SET ${sets.join(', ')} WHERE id_tarea = ?`, vals);
  const [rows] = await pool.query('SELECT * FROM tarea_programada WHERE id_tarea = ?', [id]);
  res.json(rows[0]);
}));

// Eliminar tarea programada
app.delete('/api/tareas-programadas/:id', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const id = Number(req.params.id) || 0;
  if (!userId) return res.status(401).json({ message: 'No autenticado' });
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  // Verificar permisos sobre la tarea (a través de la instalación)
  const [perm] = await pool.query(
    `SELECT 1 FROM tarea_programada tp
     JOIN instalacion i ON i.id_instalacion = tp.id_instalacion
     LEFT JOIN usuario u ON u.id_usuario = ?
     WHERE tp.id_tarea = ?
       AND (i.id_usuario_creador = ? OR (u.id_empresa IS NOT NULL AND u.id_empresa = i.id_empresa))
     LIMIT 1`,
    [userId, id, userId]
  );
  if (perm.length === 0) return res.status(403).json({ message: 'Sin permiso para esta tarea' });

  await pool.query('DELETE FROM tarea_programada WHERE id_tarea = ?', [id]);
  res.json({ ok: true, id });
}));

// Sensores por instalación con autenticación y validación de permisos
app.get('/api/instalaciones/:id/sensores', authMiddleware, asyncHandler(async (req, res) => {
  const userId = Number(req.user?.uid || 0);
  const id = Number(req.params.id) || 0;
  if (!userId) return res.status(401).json({ message: 'No autenticado' });
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  // Validar que la instalación pertenezca al usuario
  const [perm] = await pool.query(
    `SELECT 1 FROM instalacion i
     LEFT JOIN usuario u ON u.id_usuario = ?
     WHERE i.id_instalacion = ?
       AND COALESCE(i.estado_operativo, 'activo') <> 'eliminado'
       AND (i.id_usuario_creador = ? OR (u.id_empresa IS NOT NULL AND u.id_empresa = i.id_empresa))
     LIMIT 1`,
    [userId, id, userId]
  );
  if (perm.length === 0) return res.status(403).json({ message: 'Sin permiso para esta instalación' });

  const [rows] = await pool.query(
    `SELECT 
        si.id_sensor_instalado,
        COALESCE(si.nombre, si.alias, CONCAT('Sensor ', si.id_sensor_instalado)) AS nombre_sensor,
        si.estado,
        cs.nombre AS tipo_sensor,
        p.nombre  AS parametro,
        p.unidad  AS unidad,
        (SELECT CONCAT(r.fecha, ' ', r.hora, ' • ', r.promedio)
           FROM resumen_lectura_horaria r
          WHERE r.id_sensor_instalado = si.id_sensor_instalado
          ORDER BY r.fecha DESC, r.hora DESC
          LIMIT 1) AS ultima_lectura
     FROM sensor_instalado si
     LEFT JOIN catalogo_sensores cs 
            ON cs.id_catalogo_sensor = si.id_catalogo_sensor
     LEFT JOIN parametros p 
            ON p.id_parametro = si.id_parametro
    WHERE si.id_instalacion = ?
    ORDER BY si.id_sensor_instalado DESC`,
    [id]
  );

  res.json(rows);
}));

// === whoami (debug) ===
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

    // Detectar IP LAN
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
      console.log('   Endpoints completos: GET/POST /api/instalaciones, /api/instalaciones/:id/sensores, /api/tareas-programadas');
    });
  } catch (e) {
    console.error('❌ No se pudo conectar a MySQL:', e.code, e.message);
    process.exit(1);
  }
})();
