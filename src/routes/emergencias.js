const router = require('express').Router();
const pool = require('../db');
const { ah, auth, audit } = require('../middleware');

// POST /api/emergencias  { mensaje?, ubicacion? }  -> registra una alerta crítica
router.post('/', auth, ah(async (req, res) => {
  const b = req.body || {};
  const mensaje = String(b.mensaje || 'Código de emergencia activado').slice(0, 500);
  const [r] = await pool.query(
    `INSERT INTO alertas (tipo, categoria, nivel, titulo, mensaje, datos, estado, user_id, created_at, updated_at)
     VALUES ('emergencia','codigo_emergencia','critico','Código de emergencia',?,?, 'activa', ?, NOW(), NOW())`,
    [mensaje, JSON.stringify({ ubicacion: b.ubicacion || null, activadaPor: req.user.nombre }), req.user.id]);
  await audit(req, { evento: 'emergencia', modulo: 'emergencias', descripcion: `Código de emergencia activado por ${req.user.nombre}`, tipo: 'alerta', id: r.insertId, severidad: 'critical' });
  // TODO (fase 2): enviar notificación push (Firebase) a UCI, médico de guardia y seguridad
  res.status(201).json({ id: r.insertId, mensaje, estado: 'activa' });
}));

module.exports = router;
