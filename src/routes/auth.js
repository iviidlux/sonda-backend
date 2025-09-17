// src/routes/auth.js
const router = require('express').Router();
const pool = require('../../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES = '7d';

router.post('/login', async (req, res) => {
  try {
    const { correo, password } = req.body || {};
    if (!correo || !password) {
      return res.status(400).json({ error: 'correo y password son obligatorios' });
    }

    const [rows] = await pool.query(
      `SELECT u.id_usuario, u.id_rol, u.nombre_completo, u.correo, u.password_hash, u.estado, r.nombre AS rol_nombre
       FROM usuario u
       JOIN rol r ON r.id_rol = u.id_rol
       WHERE u.correo = ? LIMIT 1`,
      [correo]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const u = rows[0];

    if (u.estado !== 'activo') {
      return res.status(403).json({ error: 'Usuario inactivo' });
    }

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { id_usuario: u.id_usuario, id_rol: u.id_rol, rol: u.rol_nombre },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    return res.json({
      token,
      usuario: {
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
