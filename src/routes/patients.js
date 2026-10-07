const router = require('express').Router();
const pool = require('../db');
const { ah, HttpError, auth, roles, audit } = require('../middleware');

const NIVELES = ['rojo', 'naranja', 'amarillo', 'verde', 'azul'];
const ALIAS = { red: 'rojo', yellow: 'amarillo', green: 'verde', critico: 'rojo', urgente: 'amarillo', leve: 'verde' };
const normNivel = (v) => { const n = ALIAS[String(v || '').toLowerCase()] || String(v || '').toLowerCase(); return NIVELES.includes(n) ? n : null; };

const ACTIVAS = "('en_espera','atendido','hospitalizado')";

// GET /api/stats  -> totales del dashboard
router.get('/stats', auth, ah(async (req, res) => {
  const [[t]] = await pool.query('SELECT COUNT(*) AS n FROM pacientes WHERE activo = 1');
  const [[c]] = await pool.query(
    `SELECT
       SUM(triage = 'rojo') AS rojo,
       SUM(triage IN ('naranja','amarillo')) AS amarillo,
       SUM(triage IN ('verde','azul')) AS verde
     FROM admisiones WHERE estado IN ${ACTIVAS}`);
  res.json({ totalPatients: t.n, redCount: Number(c.rojo || 0), yellowCount: Number(c.amarillo || 0), greenCount: Number(c.verde || 0) });
}));

// GET /api/patients?triage=rojo
router.get('/patients', auth, roles('medico', 'enfermeria'), ah(async (req, res) => {
  const params = [];
  let where = 'WHERE p.activo = 1';
  const nivel = req.query.triage ? normNivel(req.query.triage) : null;
  if (nivel) { where += ' AND a.triage = ?'; params.push(nivel); }
  const [rows] = await pool.query(
    `SELECT p.id,
            CONCAT_WS(' ', p.nombre, p.apellido_paterno, p.apellido_materno) AS name,
            TIMESTAMPDIFF(YEAR, p.fecha_nacimiento, CURDATE()) AS age,
            a.motivo AS reason, a.triage AS triageLevel, a.estado AS status, a.fecha_hora_llegada AS arrivedAt
     FROM pacientes p
     LEFT JOIN admisiones a ON a.id = (SELECT MAX(id) FROM admisiones WHERE paciente_id = p.id)
     ${where} ORDER BY a.fecha_hora_llegada DESC, p.id DESC LIMIT 500`, params);
  res.json(rows);
}));

function splitName(b) {
  if (b.nombre && b.apellido_paterno) return { nombre: b.nombre, ap: b.apellido_paterno, am: b.apellido_materno || null };
  const parts = String(b.name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return { nombre: parts.slice(0, -2).join(' '), ap: parts[parts.length - 2], am: parts[parts.length - 1] };
  if (parts.length === 2) return { nombre: parts[0], ap: parts[1], am: null };
  return { nombre: parts[0] || '', ap: 'S/A', am: null };
}

// POST /api/patients  { name, age, reason, triageLevel }
router.post('/patients', auth, roles('medico', 'enfermeria'), ah(async (req, res) => {
  const b = req.body || {};
  const { nombre, ap, am } = splitName(b);
  const nivel = normNivel(b.triageLevel);
  const edad = Number(b.age);
  if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');
  if (!nivel) throw new HttpError(400, `triageLevel inválido. Usa: ${NIVELES.join(', ')}`);
  if (!b.fecha_nacimiento && !(Number.isInteger(edad) && edad >= 0 && edad <= 120)) throw new HttpError(400, 'Edad inválida (0 a 120)');
  if (!b.reason || String(b.reason).trim().length < 3) throw new HttpError(400, 'El motivo es obligatorio');

  let nacimiento = b.fecha_nacimiento;
  if (!nacimiento) { const d = new Date(); d.setFullYear(d.getFullYear() - edad); nacimiento = d.toISOString().slice(0, 10); }
  const sexo = ['hombre', 'mujer', 'otro'].includes(b.sexo) ? b.sexo : 'hombre';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [p] = await conn.query(
      `INSERT INTO pacientes (nombre, apellido_paterno, apellido_materno, fecha_nacimiento, sexo, curp, telefono_principal, activo, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,1,NOW(),NOW())`,
      [nombre, ap, am, nacimiento, sexo, b.curp || null, b.telefono || null]);
    const folio = `ADM-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(p.insertId).padStart(5, '0')}`;
    const [a] = await conn.query(
      `INSERT INTO admisiones (paciente_id, user_id, folio, fecha_hora_llegada, tipo, triage, motivo, estado, created_at, updated_at)
       VALUES (?,?,?,NOW(),'urgencias',?,?,'en_espera',NOW(),NOW())`,
      [p.insertId, req.user.id, folio, nivel, String(b.reason).trim()]);
    await audit(req, { evento: 'crear', modulo: 'pacientes', descripcion: `Paciente registrado en triage ${nivel}`, tipo: 'paciente', id: p.insertId, despues: { admision: a.insertId, triage: nivel }, severidad: nivel === 'rojo' ? 'critical' : 'info', sensible: 1 }, conn);
    await conn.commit();
    res.status(201).json({ id: p.insertId, admisionId: a.insertId, folio, triageLevel: nivel });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

// PATCH /api/patients/:id/triage  { triageLevel }
router.patch('/patients/:id/triage', auth, roles('medico'), ah(async (req, res) => {
  const nivel = normNivel((req.body || {}).triageLevel);
  if (!nivel) throw new HttpError(400, `triageLevel inválido. Usa: ${NIVELES.join(', ')}`);
  const [rows] = await pool.query('SELECT id, triage FROM admisiones WHERE paciente_id = ? ORDER BY id DESC LIMIT 1', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'El paciente no tiene admisión registrada');
  await pool.query('UPDATE admisiones SET triage = ?, updated_at = NOW() WHERE id = ?', [nivel, rows[0].id]);
  await audit(req, { evento: 'actualizar', modulo: 'pacientes', descripcion: `Prioridad cambiada de ${rows[0].triage} a ${nivel}`, tipo: 'paciente', id: Number(req.params.id), antes: { triage: rows[0].triage }, despues: { triage: nivel }, severidad: nivel === 'rojo' ? 'critical' : 'info' });
  res.json({ id: Number(req.params.id), triageLevel: nivel });
}));

module.exports = router;
