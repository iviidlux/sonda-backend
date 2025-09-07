// src/routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../db');

// Asegura que exista un rol 'operador' y devuelve su id
async function ensureOperadorRole(conn) {
  const [r] = await conn.query('SELECT id_rol FROM tipo_rol WHERE nombre = ?', ['operador']);
  if (r.length) return r[0].id_rol;
  const [ins] = await conn.query('INSERT INTO tipo_rol (nombre) VALUES (?)', ['operador']);
  return ins.insertId;
}

// POST /auth/register
router.post('/register', async (req, res) => {
  const { nombre, correo, password, telefono } = req.body || {};
  if (!nombre || !correo || !password) {
    return res.status(400).json({ error: 'nombre, correo y password son obligatorios' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dupe] = await conn.query('SELECT 1 FROM usuario WHERE correo = ?', [correo]);
    if (dupe.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'El correo ya está registrado' });
    }

    const id_rol = await ensureOperadorRole(conn);
    const hash = await bcrypt.hash(password, 10);

    const [ins] = await conn.query(
      `INSERT INTO usuario (id_rol, nombre_completo, correo, telefono, password_hash, estado)
       VALUES (?, ?, ?, ?, ?, 'activo')`,
      [id_rol, nombre, correo, telefono || null, hash]
    );

    await conn.commit();

    const token = jwt.sign(
      { id_usuario: ins.insertId, correo, id_rol },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      ok: true,
      token,
      usuario: { id_usuario: ins.insertId, nombre, correo, id_rol }
    });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'No se pudo registrar', detail: e.message });
  } finally {
    conn.release();
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { correo, password } = req.body || {};
  if (!correo || !password) return res.status(400).json({ error: 'correo y password requeridos' });

  try {
    const [rows] = await pool.query(
      'SELECT id_usuario, id_rol, nombre_completo, correo, password_hash FROM usuario WHERE correo = ? AND estado = "activo"',
      [correo]
    );
    if (!rows.length) return res.status(401).json({ error: 'Credenciales inválidas' });

    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id_usuario: u.id_usuario, correo: u.correo, id_rol: u.id_rol },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.json({
      ok: true,
      token,
      usuario: { id_usuario: u.id_usuario, nombre: u.nombre_completo, correo: u.correo, id_rol: u.id_rol }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo iniciar sesión', detail: e.message });
  }
});

module.exports = router;
