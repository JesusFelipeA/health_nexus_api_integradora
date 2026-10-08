require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { errorHandler } = require('./middleware');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());

const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => (!origin || origins.includes(origin) ? cb(null, true) : cb(new Error('Origen no permitido por CORS'))),
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/patients'));        // /stats y /patients
app.use('/api/derivaciones', require('./routes/derivaciones'));
app.use('/api/hospitals', require('./routes/hospitals'));
app.use('/api/seguimiento', require('./routes/seguimiento'));
app.use('/api/auditoria', require('./routes/auditoria'));
app.use('/api/emergencias', require('./routes/emergencias'));
app.use('/api/farmacia', require('./routes/farmacia'));
app.use('/api/enfermeria', require('./routes/enfermeria'));

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(errorHandler);

module.exports = app;
