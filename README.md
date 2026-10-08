# HealthNexus API

API REST en **Node.js + Express + MySQL**, construida sobre tu base `healthnexusdb` (la del dump `Dump20261006.sql`).
Usa los mismos usuarios, roles y contraseñas (bcrypt) que el panel web.

## Puesta en marcha

1. Instala Node.js 18 o superior y ten MySQL con tu base `healthnexusdb` cargada.
2. Aplica los cambios mínimos para hospitales (una sola vez):
   `mysql -u root -p healthnexusdb < database/extra.sql`
3. Copia `.env.example` a `.env` y completa `DB_USER`, `DB_PASS` y `JWT_SECRET`.
4. `npm install`
5. `npm run dev` (o `npm start`). Prueba: http://localhost:3000/api/health

## Endpoints (todos bajo `/api`; salvo login, requieren `Authorization: Bearer <token>`)

| Método | Ruta | Roles | Tablas |
|---|---|---|---|
| POST | /auth/login | público | users, roles |
| GET | /auth/me | todos | users |
| GET | /stats | todos | pacientes, admisiones |
| GET | /patients?triage= | médico, enfermería | pacientes, admisiones |
| POST | /patients | médico, enfermería | pacientes, admisiones |
| PATCH | /patients/:id/triage | médico | admisiones |
| GET | /derivaciones/camas | médico, enfermería | camas, servicios (camas disponibles; lo usa la app para elegir destino) |
| GET | /derivaciones/internas | médico, enfermería | cama_paciente, camas, servicios |
| POST | /derivaciones/internas | médico | cama_paciente, camas, seguimientos |
| PATCH | /derivaciones/internas/:id | médico, enfermería | cama_paciente, camas |
| GET | /derivaciones/externas | médico | admisiones, hospitales |
| POST | /derivaciones/externas | médico | admisiones |
| GET | /hospitals?lat=&lng= | todos | hospitales |
| POST | /hospitals/:id/reservas | médico | hospitales, reservas_hospital |
| GET | /seguimiento | todos | seguimientos, pacientes, camas |
| GET | /auditoria | administrador | audit_logs |
| POST | /emergencias | todos | alertas |
| GET | /farmacia/resumen | farmacia | medicamentos, lotes |
| GET | /farmacia/medicamentos?q=&estado=bajo\|sin_stock | farmacia | medicamentos |
| GET | /farmacia/catalogo?q= | farmacia, enfermería, médico | medicamentos (lista corta, sin precios) |
| GET | /farmacia/existencias?q=&caduca=vencidos\|30 | farmacia, enfermería, médico | lotes, medicamentos |
| GET | /farmacia/movimientos?tipo=&q= | farmacia, enfermería | movimientos_inventario |
| POST | /farmacia/movimientos | farmacia | lotes, medicamentos, movimientos_inventario |
| GET | /farmacia/alertas | farmacia | medicamentos, lotes |
| GET | /enfermeria/signos?pacienteId= | enfermería, médico | signos_vitales |
| POST | /enfermeria/signos | enfermería | signos_vitales |
| GET | /enfermeria/administraciones?pacienteId= | enfermería, médico | administraciones_medicamento |
| POST | /enfermeria/administraciones | enfermería | administraciones_medicamento |

El administrador tiene acceso a todo. Cada acción importante se registra en `audit_logs`.

## Permisos por rol (alineados con los permisos de tu tabla `permissions`)

| Rol | Puede usar |
|---|---|
| administrador | todo |
| médico | stats, pacientes, triage, derivaciones, hospitales, seguimiento, existencias, signos y administraciones (solo lectura) |
| enfermería | lo anterior de pacientes y derivaciones, **registrar** signos vitales y administración de medicamentos, existencias y movimientos (solo lectura) |
| farmacia | resumen, medicamentos, existencias, movimientos (**registrar**), alertas y emergencias. No ve pacientes, seguimiento, hospitales ni auditoría |

`/emergencias` y `/auth/me` están abiertos a cualquier rol con sesión.

## Crear usuarios de prueba (tu BD solo trae administrador y médico)
```
node scripts/crear-usuario.js enfermera@hospital.com "Nombre Apellido" enfermeria "Contraseña123"
node scripts/crear-usuario.js farmacia@hospital.com "Nombre Apellido" farmacia "Contraseña123"
```
El script usa bcrypt en formato Laravel y asigna el rol en `model_has_roles`.

## Cuerpos de ejemplo

```json
POST /auth/login          { "email": "...", "password": "..." }
POST /patients            { "name": "Juan Pérez López", "age": 45, "reason": "Dolor torácico", "triageLevel": "rojo" }
PATCH /patients/5/triage  { "triageLevel": "amarillo" }
POST /derivaciones/internas  { "pacienteId": 5, "camaId": 2, "motivo": "Pasa a observación" }
PATCH /derivaciones/internas/1 { "estado": "finalizada" }
POST /derivaciones/externas  { "pacienteId": 5, "hospitalId": 1, "motivo": "Requiere UCI" }
POST /hospitals/1/reservas   { "pacienteId": 5 }
POST /emergencias         { "mensaje": "Paro cardiaco en urgencias" }
POST /farmacia/movimientos { "loteId": 12, "tipo": "salida", "cantidad": 3, "motivo": "Dispensación" }
POST /enfermeria/signos   { "pacienteId": 5, "temperatura": 36.8, "frecuenciaCardiaca": 80, "presionArterial": "120/80", "saturacionOxigeno": 97 }
POST /enfermeria/administraciones { "pacienteId": 5, "medicamentoId": 3, "dosis": "500 mg", "reaccionAdversa": false }
```

Movimientos: `entrada` y `devolucion` suman, `salida` resta, `ajuste` fija la nueva cantidad del lote. Cada movimiento actualiza `lotes.cantidad_disponible` y `medicamentos.stock_actual` en una sola transacción.

## Cómo se adaptó a tu base de datos

- **Triage:** acepta `rojo, naranja, amarillo, verde, azul` (los de tu BD) y los alias `red, yellow, green`. En `/stats`, `yellowCount` suma naranja + amarillo y `greenCount` suma verde + azul.
- **POST /patients:** crea el paciente y su admisión de urgencias. Si solo envías `name` y `age`, separa nombre y apellidos y calcula una fecha de nacimiento aproximada; puedes enviar también `nombre`, `apellido_paterno`, `fecha_nacimiento`, `sexo`, `curp`.
- **Derivaciones internas:** usan `cama_paciente` (asignar cama = traslado confirmado; finalizar libera la cama a "limpieza") y dejan un registro tipo `traslado` en `seguimientos`.
- **Derivaciones externas:** actualizan la última admisión del paciente (`hospital_derivado_id`, estado `derivado`).
- **Hospitales:** tu tabla no tenía camas ni reservas, por eso `database/extra.sql` agrega `camas_totales`, `camas_disponibles` y la tabla `reservas_hospital`, además de 3 hospitales de ejemplo si la tabla está vacía.
- **Emergencias:** se guardan como alerta crítica en `alertas`.
- **Seguridad:** JWT con expiración, bcrypt (los hashes `$2y$` de Laravel funcionan), 5 intentos fallidos de login por IP cada 15 minutos, helmet, CORS limitado (`CORS_ORIGINS`), consultas preparadas y auditoría.

## Pendiente (siguiente fase)

- Notificaciones push con Firebase (`POST /emergencias` ya tiene el punto marcado con TODO).
- Publicar con HTTPS (Nginx) y un `JWT_SECRET` largo y distinto al de pruebas.
- Dispensación de recetas (sale de `consulta_medicamento`, que hoy está vacía) y que la administración de enfermería descuente inventario: no se incluyeron.
