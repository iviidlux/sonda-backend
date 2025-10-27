// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

module.exports = (req, res, next) => {
  try {
    const h = req.headers.authorization || '';
    const parts = h.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const payload = jwt.verify(parts[1], JWT_SECRET);
    req.user = payload; // { id_usuario, id_rol, rol }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
