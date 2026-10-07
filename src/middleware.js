const jwt = require('jsonwebtoken');
const pool = require('./db');

// Envuelve handlers async para que los errores lleguen al errorHandler
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Error con código HTTP
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Verifica el JWT (Authorization: Bearer <token>)
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Permite solo ciertos roles (el administrador siempre pasa)
const roles = (...permitidos) => (req, res, next) => {
  const rol = req.user && req.user.rol;
  if (rol === 'administrador' || permitidos.includes(rol)) return next();
  res.status(403).json({ error: 'No tienes permiso para esta acción' });
};

// Registra una acción en audit_logs (tabla de solo inserción)
async function audit(req, { evento, modulo, descripcion, tipo = null, id = null, antes = null, despues = null, severidad = 'info', sensible = 0, actor = null }, conn = pool) {
  const u = actor || req.user || {};
  await conn.query(
    `INSERT INTO audit_logs (user_id, user_nombre, user_rol, evento, modulo, descripcion, auditable_type, auditable_id,
       datos_antes, datos_despues, metadata, severidad, es_sensible, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
    [u.id || null, u.nombre || null, u.rol || null, evento, modulo, String(descripcion).slice(0, 255), tipo, id,
     antes ? JSON.stringify(antes) : null, despues ? JSON.stringify(despues) : null,
     JSON.stringify({ ip: req.ip, ua: req.headers['user-agent'] || null }), severidad, sensible]
  );
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : err.message });
}

module.exports = { ah, HttpError, auth, roles, audit, errorHandler };
