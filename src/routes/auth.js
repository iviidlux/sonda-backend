// src/routes/auth.js - ACTUALIZADO
const router = require('express').Router();
const pool = require('../../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES = '7d';

// Registro de usuario - ACTUALIZADO
router.post('/register', async (req, res) => {
  try {
    const {
      nombre_completo,
      correo,
      password,
      telefono = null,
      id_rol = 2, // admin_cuenta por defecto
    } = req.body || {};

    if (!nombre_completo || !correo || !password) {
      return res.status(400).json({ error: 'nombre_completo, correo y password son obligatorios' });
    }

    // Verificar correo existente
    const [ex] = await pool.query('SELECT id_usuario FROM usuario WHERE correo = ? LIMIT 1', [correo]);
    if (ex.length) return res.status(409).json({ error: 'El correo ya está registrado' });

    const hash = await bcrypt.hash(password, 10);

    // CAMBIO: nuevo esquema usa 'activo' BOOLEAN, no 'activo' STRING
    const [ins] = await pool.query(
      `INSERT INTO usuario (correo, password_hash, nombre_completo, id_rol, activo)
       VALUES (?, ?, ?, ?, true)`,
      [correo, hash, nombre_completo, id_rol]
    );

    // CAMBIO: usar tipo_rol en lugar de rol
    const [row] = await pool.query(
      `SELECT u.id_usuario, u.id_rol, u.nombre_completo, u.correo, u.activo, r.nombre AS rol_nombre
       FROM usuario u JOIN tipo_rol r ON r.id_rol = u.id_rol
       WHERE u.id_usuario = ?`, [ins.insertId]
    );

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
        activo: u.activo,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error creando usuario', detail: e.message });
  }
});

// Login - ACTUALIZADO
router.post('/login', async (req, res) => {
  try {
    const { correo, password } = req.body || {};
    if (!correo || !password) {
      return res.status(400).json({ error: 'correo y password son obligatorios' });
    }

    // CAMBIO: usar tipo_rol y campo activo BOOLEAN
    const [rows] = await pool.query(
      `SELECT u.*, r.nombre AS rol_nombre
       FROM usuario u JOIN tipo_rol r ON r.id_rol = u.id_rol
       WHERE u.correo = ? LIMIT 1`, [correo]
    );
    
    if (!rows.length) return res.status(401).json({ error: 'Credenciales inválidas' });

    const u = rows[0];
    // CAMBIO: activo es BOOLEAN, no STRING
    if (!u.activo) return res.status(403).json({ error: 'Usuario inactivo' });

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
        activo: u.activo,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error en login', detail: e.message });
  }
});

module.exports = router;
