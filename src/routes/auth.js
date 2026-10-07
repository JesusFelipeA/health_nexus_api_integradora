const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { ah, auth, audit } = require('../middleware');

// 5 intentos fallidos por IP cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, skipSuccessfulRequests: true,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
});

const USER_SQL = `
  SELECT u.id, u.name, u.email, u.password, u.activo, r.name AS rol
  FROM users u
  LEFT JOIN model_has_roles mr ON mr.model_id = u.id AND mr.model_type LIKE '%User'
  LEFT JOIN roles r ON r.id = mr.role_id`;

// POST /api/auth/login
router.post('/login', loginLimiter, ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });

  const [rows] = await pool.query(`${USER_SQL} WHERE u.email = ? LIMIT 1`, [String(email).trim().toLowerCase()]);
  const u = rows[0];
  const ok = u && u.activo === 1 && (await bcrypt.compare(String(password), u.password));
  if (!ok) {
    await audit(req, { evento: 'login_fallido', modulo: 'auth', descripcion: `Intento de acceso fallido: ${String(email).slice(0, 100)}`, severidad: 'warning',
      actor: u ? { id: u.id, nombre: u.name, rol: u.rol } : null });
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const user = { id: u.id, nombre: u.name, email: u.email, rol: u.rol || 'sin_rol' };
  const token = jwt.sign({ id: user.id, nombre: user.nombre, rol: user.rol }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '8h' });
  await audit(req, { evento: 'login', modulo: 'auth', descripcion: 'Inicio de sesión', actor: user });
  res.json({ token, user });
}));

// GET /api/auth/me
router.get('/me', auth, ah(async (req, res) => {
  const [rows] = await pool.query(`${USER_SQL} WHERE u.id = ? LIMIT 1`, [req.user.id]);
  if (!rows[0] || rows[0].activo !== 1) return res.status(401).json({ error: 'Usuario no disponible' });
  res.json({ id: rows[0].id, nombre: rows[0].name, email: rows[0].email, rol: rows[0].rol || 'sin_rol' });
}));

module.exports = router;
