// src/routes/auth.js
const router = require('express').Router();
const pool = require('../../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES = '7d';

// Registro de usuario
router.post('/register', async (req, res) => {
  try {
    const {
      nombre_completo, // obligatorio
      correo,          // obligatorio (UNIQUE)
      password,        // obligatorio
      telefono = null,
      id_rol = 2,      // por default admin_cuenta
    } = req.body || {};

    if (!nombre_completo || !correo || !password) {
      return res.status(400).json({ error: 'nombre_completo, correo y password son obligatorios' });
    }

    // ¿existe ya ese correo?
    const [ex] = await pool.query('SELECT id_usuario FROM usuario WHERE correo = ? LIMIT 1', [correo]);
    if (ex.length) return res.status(409).json({ error: 'El correo ya está registrado' });

    const hash = await bcrypt.hash(password, 10);

    const [ins] = await pool.query(
      `INSERT INTO usuario (id_rol, nombre_completo, correo, password_hash, telefono, estado)
       VALUES (?, ?, ?, ?, ?, 'activo')`,
      [id_rol, nombre_completo, correo, hash, telefono]
    );

    const [row] = await pool.query(
      `SELECT u.id_usuario, u.id_rol, u.nombre_completo, u.correo, u.estado, r.nombre AS rol_nombre
       FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
       WHERE u.id_usuario = ?`, [ins.insertId]
    );

    // token inmediato tras registro
    const u = row[0];
    const token = jwt.sign(
      { id_usuario: u.id_usuario, id_rol: u.id_rol, rol: u.rol_nombre },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    return res.status(201).json({
      token,
      user: {
        id_usuario: u.id_usuario,
        id_rol: u.id_rol,
        rol: u.rol_nombre,
        nombre_completo: u.nombre_completo,
        correo: u.correo,
        estado: u.estado,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error creando usuario', detail: e.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { correo, password } = req.body || {};
    if (!correo || !password) {
      return res.status(400).json({ error: 'correo y password son obligatorios' });
    }

    const [rows] = await pool.query(
      `SELECT u.*, r.nombre AS rol_nombre
       FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
       WHERE u.correo = ? LIMIT 1`, [correo]
    );
    if (!rows.length) return res.status(401).json({ error: 'Credenciales inválidas' });

    const u = rows[0];
    if (u.estado !== 'activo') return res.status(403).json({ error: 'Usuario inactivo' });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id_usuario: u.id_usuario, id_rol: u.id_rol, rol: u.rol_nombre },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      token,
      user: {
        id_usuario: u.id_usuario,
        id_rol: u.id_rol,
        rol: u.rol_nombre,
        nombre_completo: u.nombre_completo,
        correo: u.correo,
        estado: u.estado,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error en login', detail: e.message });
  }
});

module.exports = router;
