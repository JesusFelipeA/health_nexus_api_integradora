const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const pool = require("../db");
const crypto = require("crypto");
const { ah, auth, audit, HttpError } = require("../middleware");

// 5 intentos fallidos por IP cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Intenta de nuevo en 15 minutos." },
});

const USER_SQL = `
  SELECT u.id, u.name, u.email, u.password, u.activo, r.name AS rol
  FROM users u
  LEFT JOIN model_has_roles mr ON mr.model_id = u.id AND mr.model_type LIKE '%User'
  LEFT JOIN roles r ON r.id = mr.role_id`;

async function registrarDispositivo(req, userId) {
  const huellaCliente = req.get("X-Device-Fingerprint");

  if (!huellaCliente || huellaCliente.length > 255) {
    throw new HttpError(400, "Falta una huella de dispositivo válida");
  }

  // Debe coincidir con el SHA-256 que calcula Laravel para este encabezado.
  const huella = crypto
    .createHash("sha256")
    .update(huellaCliente)
    .digest("hex");

  const userAgent = String(req.get("user-agent") || "").slice(0, 500);
  const ua = userAgent.toLowerCase();

  let tipo = "desktop";
  let sistemaOperativo = "Desconocido";
  let navegador = "Desconocido";

  if (/ipad|tablet/.test(ua)) {
    tipo = "tablet";
  } else if (
    /mobile|android|iphone|ipod|okhttp|cfnetwork|darwin|react-native|flutter|dart/.test(
      ua,
    )
  ) {
    tipo = "mobile";
  }

  if (ua.includes("okhttp")) {
    sistemaOperativo = "Android";
    navegador = "React Native (Android)";
  } else if (ua.includes("cfnetwork") || ua.includes("darwin")) {
    sistemaOperativo = "iOS";
    navegador = "React Native (iOS)";
  } else if (ua.includes("android")) {
    sistemaOperativo = "Android";
    navegador = "Aplicación móvil";
  } else if (/iphone|ipad|ipod/.test(ua)) {
    sistemaOperativo = "iOS";
    navegador = "Aplicación móvil";
  } else if (ua.includes("windows")) {
    sistemaOperativo = "Windows";
  } else if (ua.includes("mac os")) {
    sistemaOperativo = "macOS";
  } else if (ua.includes("linux")) {
    sistemaOperativo = "Linux";
  }

  const nombre = `${navegador} en ${sistemaOperativo}`.slice(0, 255);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // El índice único compuesto permite la misma instalación para distintos usuarios.
    // Si ya existe para este usuario, el no-op preserva su estado.
    await conn.query(
      `INSERT INTO dispositivos
        (user_id, huella, nombre, tipo, sistema_operativo, navegador, user_agent,
         ip_registro, ip_ultimo_acceso, confiable, activo, ultimo_acceso,
         total_accesos, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, NOW(), 0, NOW(), NOW())
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        userId,
        huella,
        nombre,
        tipo,
        sistemaOperativo,
        navegador,
        userAgent,
        req.ip || null,
        req.ip || null,
      ],
    );

    const [rows] = await conn.query(
      `SELECT id, activo
       FROM dispositivos
       WHERE user_id = ? AND huella = ?
       FOR UPDATE`,
      [userId, huella],
    );

    const dispositivo = rows[0];

    if (!dispositivo) {
      throw new HttpError(500, "No se pudo registrar el dispositivo");
    }

    if (!dispositivo.activo) {
      throw new HttpError(403, "Este dispositivo está bloqueado");
    }

    await conn.query(
      `UPDATE dispositivos
       SET nombre = ?, tipo = ?, sistema_operativo = ?, navegador = ?,
           user_agent = ?, ip_ultimo_acceso = ?, ultimo_acceso = NOW(),
           total_accesos = total_accesos + 1, updated_at = NOW()
       WHERE id = ?`,
      [
        nombre,
        tipo,
        sistemaOperativo,
        navegador,
        userAgent,
        req.ip || null,
        dispositivo.id,
      ],
    );

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// POST /api/auth/login
router.post(
  "/login",
  loginLimiter,
  ah(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res
        .status(400)
        .json({ error: "Correo y contraseña son obligatorios" });

    const [rows] = await pool.query(`${USER_SQL} WHERE u.email = ? LIMIT 1`, [
      String(email).trim().toLowerCase(),
    ]);
    const u = rows[0];
    const ok =
      u &&
      u.activo === 1 &&
      (await bcrypt.compare(String(password), u.password));
    if (!ok) {
      await audit(req, {
        evento: "login_fallido",
        modulo: "auth",
        descripcion: `Intento de acceso fallido: ${String(email).slice(0, 100)}`,
        severidad: "warning",
        actor: u ? { id: u.id, nombre: u.name, rol: u.rol } : null,
      });
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }

    await registrarDispositivo(req, u.id);

    const user = {
      id: u.id,
      nombre: u.name,
      email: u.email,
      rol: u.rol || "sin_rol",
    };
    const token = jwt.sign(
      { id: user.id, nombre: user.nombre, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || "8h" },
    );

    await audit(req, {
      evento: "login",
      modulo: "auth",
      descripcion: "Inicio de sesión",
      actor: user,
    });

    res.json({ token, user });
  }),
);

// GET /api/auth/me
router.get(
  "/me",
  auth,
  ah(async (req, res) => {
    const [rows] = await pool.query(`${USER_SQL} WHERE u.id = ? LIMIT 1`, [
      req.user.id,
    ]);
    if (!rows[0] || rows[0].activo !== 1)
      return res.status(401).json({ error: "Usuario no disponible" });
    res.json({
      id: rows[0].id,
      nombre: rows[0].name,
      email: rows[0].email,
      rol: rows[0].rol || "sin_rol",
    });
  }),
);

module.exports = router;
