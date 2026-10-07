require('dotenv').config();
const app = require('./app');
const pool = require('./db');

if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en el archivo .env');
  process.exit(1);
}

const port = Number(process.env.PORT || 3000);
pool.query('SELECT 1')
  .then(() => app.listen(port, () => console.log(`HealthNexus API en http://localhost:${port}`)))
  .catch((e) => { console.error('No se pudo conectar a MySQL:', e.message); process.exit(1); });
