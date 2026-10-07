SET NAMES utf8mb4;
-- Cambios mínimos sobre tu base de datos para los endpoints de hospitales.
-- Solo AGREGA columnas/tablas; no modifica nada existente de Laravel.
-- Ejecutar una sola vez:  mysql -u root -p healthnexusdb < database/extra.sql

ALTER TABLE hospitales
  ADD COLUMN camas_totales INT NOT NULL DEFAULT 0,
  ADD COLUMN camas_disponibles INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS reservas_hospital (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  paciente_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED DEFAULT NULL,
  ticket VARCHAR(40) NOT NULL,
  estado ENUM('reservada','cancelada','usada') NOT NULL DEFAULT 'reservada',
  created_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY reservas_hospital_ticket_unique (ticket),
  KEY reservas_hospital_hospital_idx (hospital_id),
  KEY reservas_hospital_paciente_idx (paciente_id),
  CONSTRAINT reservas_hospital_hospital_fk FOREIGN KEY (hospital_id) REFERENCES hospitales (id),
  CONSTRAINT reservas_hospital_paciente_fk FOREIGN KEY (paciente_id) REFERENCES pacientes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hospitales de ejemplo (solo si la tabla está vacía; ajusta datos y coordenadas)
INSERT INTO hospitales (nombre, tipo, nivel, direccion, telefono, latitud, longitud, tiene_urgencias, tiene_uci, activo, camas_totales, camas_disponibles, created_at, updated_at)
SELECT * FROM (
  SELECT 'Hospital General Toluca' AS nombre, 'publico' AS tipo, 'segundo' AS nivel, 'Toluca, Edo. Méx.' AS direccion, '7220000001' AS telefono, 19.2826000 AS latitud, -99.6557000 AS longitud, 1 AS tiene_urgencias, 1 AS tiene_uci, 1 AS activo, 40 AS camas_totales, 12 AS camas_disponibles, NOW() AS created_at, NOW() AS updated_at
  UNION ALL SELECT 'Hospital Regional Lerma','publico','segundo','Lerma, Edo. Méx.','7280000002',19.2850000,-99.5100000,1,0,1,25,0,NOW(),NOW()
  UNION ALL SELECT 'Clínica Metepec','privado','primero','Metepec, Edo. Méx.','7220000003',19.2500000,-99.6000000,1,1,1,18,5,NOW(),NOW()
) t WHERE NOT EXISTS (SELECT 1 FROM hospitales);
