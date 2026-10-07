const router = require('express').Router();
const pool = require('../db');
const crypto = require('crypto');
const { ah, HttpError, auth, roles, audit } = require('../middleware');

// GET /api/hospitals?lat=19.28&lng=-99.65  (distancia en km si se envía la ubicación)
router.get('/', auth, ah(async (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  const hasPos = Number.isFinite(lat) && Number.isFinite(lng);
  const dist = hasPos
    ? `ROUND(6371 * ACOS(LEAST(1, COS(RADIANS(?)) * COS(RADIANS(latitud)) * COS(RADIANS(longitud) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(latitud)))), 1)`
    : 'NULL';
  const params = hasPos ? [lat, lng, lat] : [];
  const [rows] = await pool.query(
    `SELECT id, nombre, tipo, nivel, direccion, telefono, latitud, longitud,
            tiene_urgencias AS tieneUrgencias, tiene_uci AS tieneUci,
            camas_totales AS camasTotales, camas_disponibles AS camasDisponibles,
            ${dist} AS distanciaKm
     FROM hospitales WHERE activo = 1
     ORDER BY ${hasPos ? 'distanciaKm ASC' : 'nombre ASC'}`, params);
  res.json(rows);
}));

// POST /api/hospitals/:id/reservas  { pacienteId }
router.post('/:id/reservas', auth, roles('medico'), ah(async (req, res) => {
  const { pacienteId } = req.body || {};
  if (!pacienteId) throw new HttpError(400, 'pacienteId es obligatorio');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[h]] = await conn.query('SELECT id, nombre, camas_disponibles FROM hospitales WHERE id = ? AND activo = 1 FOR UPDATE', [req.params.id]);
    if (!h) throw new HttpError(404, 'Hospital no encontrado');
    if (h.camas_disponibles <= 0) throw new HttpError(409, 'Sin camas disponibles');
    const [[p]] = await conn.query('SELECT id FROM pacientes WHERE id = ? AND activo = 1', [pacienteId]);
    if (!p) throw new HttpError(404, 'Paciente no encontrado');

    const ticket = `TK-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    await conn.query('UPDATE hospitales SET camas_disponibles = camas_disponibles - 1, updated_at = NOW() WHERE id = ?', [h.id]);
    const [r] = await conn.query(
      'INSERT INTO reservas_hospital (hospital_id, paciente_id, user_id, ticket, created_at, updated_at) VALUES (?,?,?,?,NOW(),NOW())',
      [h.id, pacienteId, req.user.id, ticket]);
    await audit(req, { evento: 'crear', modulo: 'hospitales', descripcion: `Reserva de cama en ${h.nombre} (${ticket})`, tipo: 'reserva_hospital', id: r.insertId, despues: { pacienteId, ticket } }, conn);
    await conn.commit();
    res.status(201).json({ id: r.insertId, ticket, hospital: h.nombre, camasDisponibles: h.camas_disponibles - 1 });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

module.exports = router;
