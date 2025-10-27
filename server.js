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

// INSTALACIONES CON DEBUG MEJORADO
app.get('/api/instalaciones', authMiddleware, asyncHandler(async (req, res) => {
  console.log('🔍 Listando instalaciones para usuario:', req.user.uid);
  
  const [rows] = await pool.query(`
    SELECT 
      i.id_instalacion,
      i.nombre_instalacion AS nombre,
      COALESCE(i.descripcion, '') AS ubicacion,
      'activo' AS estado,
      0 AS sensores
    FROM instalacion i
    ORDER BY i.nombre_instalacion ASC
  `);
  
  console.log('✅ Instalaciones encontradas:', rows.length);
  res.json(rows);
}));

// POST CON DEBUG COMPLETO
app.post('/api/instalaciones', authMiddleware, asyncHandler(async (req, res) => {
  console.log('📝 POST /api/instalaciones recibido');
  console.log('📦 req.body completo:', JSON.stringify(req.body, null, 2));
  console.log('📋 Content-Type:', req.headers['content-type']);
  console.log('👤 Usuario:', req.user.uid);
  
  // Extraer todos los posibles nombres de campos
  const {
    nombre,           // Español
    name,            // Inglés  
    nombre_instalacion, // Como está en la DB
    nombreInstalacion,  // camelCase
    title,           // Alternativo
    descripcion,
    description,
    desc
  } = req.body || {};
  
  // Ser súper flexible con el nombre del campo
  const finalNombre = nombre || name || nombre_instalacion || nombreInstalacion || title;
  const finalDescripcion = descripcion || description || desc || '';
  
  console.log('🏷️ Campo nombre encontrado:', finalNombre);
  console.log('📝 Campo descripcion encontrado:', finalDescripcion);
  console.log('🔑 Todos los campos disponibles:', Object.keys(req.body || {}));
  
  // Validación más permisiva
  if (!finalNombre) {
    console.log('❌ Error: no se encontró campo de nombre');
    return res.status(400).json({ 
      message: 'nombre requerido',
      debug: {
        received_body: req.body,
        available_fields: Object.keys(req.body || {}),
        content_type: req.headers['content-type'],
        expected_fields: ['nombre', 'name', 'nombre_instalacion', 'nombreInstalacion', 'title'],
        usuario: req.user.uid
      }
    });
  }

  if (typeof finalNombre !== 'string' || finalNombre.trim().length === 0) {
    console.log('❌ Error: nombre vacío o no es string');
    return res.status(400).json({ 
      message: 'nombre debe ser un texto no vacío',
      debug: {
        nombre_value: finalNombre,
        nombre_type: typeof finalNombre,
        nombre_length: finalNombre ? finalNombre.length : 0
      }
    });
  }

  console.log('✅ Creando instalación con nombre:', finalNombre.trim());

  try {
    const [result] = await pool.query(
      `INSERT INTO instalacion (id_empresa_sucursal, nombre_instalacion, descripcion) VALUES (1, ?, ?)`,
      [finalNombre.trim(), finalDescripcion.toString()]
    );

    console.log('✅ INSERT exitoso, ID:', result.insertId);

    const [rows] = await pool.query(
      `SELECT 
        i.id_instalacion AS id,
        i.nombre_instalacion AS nombre,
        COALESCE(i.descripcion, '') AS descripcion,
        'activo' AS estado,
        i.fecha_creacion AS fechaInstalacion
      FROM instalacion i WHERE i.id_instalacion = ?`,
      [result.insertId]
    );

    console.log('🎉 Instalación creada exitosamente:', rows[0]);
    res.status(201).json(rows[0]);

  } catch (dbError) {
    console.error('❌ Error de base de datos:', dbError.message);
    res.status(500).json({ 
      message: 'Error al crear instalación',
      error: dbError.message 
    });
  }
}));

// Sensores simplificado
app.get('/api/instalaciones/:id/sensores', authMiddleware, asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  console.log('🔧 Buscando sensores para instalación:', id);

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
    [id]
  );

  console.log('✅ Sensores encontrados:', rows.length);
  res.json(rows);
}));

// Lecturas
app.get('/api/lecturas/resumen', asyncHandler(async (_req, res) => {
  console.log('📊 Solicitud de resumen de lecturas');
  res.json([]); // Respuesta vacía por ahora
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

// 404
app.use((req, res) => {
  console.log('❓ Ruta no encontrada:', req.method, req.url);
  res.status(404).json({ message: 'Ruta no encontrada' });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('💥 ERROR GLOBAL:', {
    message: err.message,
    stack: err.stack?.split('\n').slice(0, 3),
    url: req.url,
    method: req.method
  });
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
      console.log('🚀 API AquaSense iniciada:');
      console.log(`   • Local: http://127.0.0.1:${PORT}`);
      console.log(`   • LAN:   http://${lanIP}:${PORT}`);
      console.log('   🔍 Modo DEBUG habilitado - verás logs detallados');
      console.log('   📡 Endpoints: GET/POST /api/instalaciones');
    });
  } catch (e) {
    console.error('❌ Error al conectar MySQL:', e.message);
    process.exit(1);
  }
})();
