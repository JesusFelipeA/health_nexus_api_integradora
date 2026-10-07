const router = require('express').Router();
const pool = require('../db');
const { ah, auth } = require('../middleware');

// GET /api/seguimiento  -> último registro de seguimiento por paciente
router.get('/', auth, ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.id, s.paciente_id AS pacienteId,
            CONCAT_WS(' ', p.nombre, p.apellido_paterno, p.apellido_materno) AS paciente,
            s.tipo, s.estado_paciente AS estado, s.contenido, c.codigo AS cama,
            s.created_at AS fecha, TIMESTAMPDIFF(MINUTE, s.created_at, NOW()) AS minutos
     FROM seguimientos s
     JOIN pacientes p ON p.id = s.paciente_id
     LEFT JOIN camas c ON c.id = s.cama_id
     WHERE s.id = (SELECT MAX(id) FROM seguimientos WHERE paciente_id = s.paciente_id)
     ORDER BY s.created_at DESC LIMIT 200`);
  res.json(rows);
}));

module.exports = router;
