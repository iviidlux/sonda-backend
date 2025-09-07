// src/middleware/auth.js
const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = payload; // { id_usuario, correo, id_rol }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido', detail: e.message });
  }
}

module.exports = auth;
