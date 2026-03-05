# E2E Runner - Multi-Instance Sync API Plan (Unified)

## Executive Summary

**Una sola instancia de e2e-runner puede actuar como Hub o Agent** — sin paquetes externos, sin PostgreSQL, sin Redis. Solo SQLite + el servidor HTTP/WebSocket que ya existe.

---

## 1. Arquitectura Unificada

### 1.1 Modelo: Peer con Hub Mode

```
┌─────────────────────────────────────────────────────────────┐
│              Cualquier instancia puede ser Hub              │
└─────────────────────────────────────────────────────────────┘

     ┌─────────────────────────────────────────────┐
     │         INSTANCIA A (Hub Mode)              │
     │  ┌──────────────────────────────────────┐   │
     │  │ Dashboard existente (puerto 8484)    │   │
     │  │ + nuevas rutas /api/sync/*           │   │
     │  │ + WebSocket broadcast existente      │   │
     │  │ + SQLite ~/.e2e-runner/dashboard.db  │   │
     │  └──────────────────────────────────────┘   │
     └──────────────────┬──────────────────────────┘
                        │
           TLS 1.3 + API Key + TOTP
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Instancia B  │ │ Instancia C  │ │ Instancia D  │
│ (Agent Mode) │ │ (Agent Mode) │ │ (Agent Mode) │
│              │ │              │ │              │
│ SQLite local │ │ SQLite local │ │ SQLite local │
│ Sync client  │ │ Sync client  │ │ Sync client  │
└──────────────┘ └──────────────┘ └──────────────┘
```

### 1.2 Modos de Operación

```javascript
// e2e.config.js
export default {
  // ... config existente ...
  
  sync: {
    // Modo Hub: acepta conexiones de otros agents
    mode: 'hub',  // 'hub' | 'agent' | 'standalone' (default)
    
    // --- Config para modo Hub ---
    hub: {
      // Puerto separado para sync API (o usar dashboardPort)
      port: 8485,               // null = usar dashboardPort
      // Permitir registro de nuevos agents
      allowRegistration: true,
      // Requerir aprobación manual de nuevos agents
      requireApproval: false,
    },
    
    // --- Config para modo Agent ---
    agent: {
      hubUrl: 'https://192.168.1.100:8485',
      instanceId: 'dev-laptop-juan',
      displayName: 'Juan Dev Laptop',
      
      // Credenciales (de env vars)
      apiKeyEnv: 'E2E_SYNC_API_KEY',
      totpSecretEnv: 'E2E_SYNC_TOTP',
      
      // Certificados para mTLS (opcional, máxima seguridad)
      certPath: './certs/agent.pem',
      keyPath: './certs/agent-key.pem',
      caPath: './certs/ca.pem',
      
      // Comportamiento
      autoSync: true,         // Push después de cada run
      pullOnDashboard: true,  // Pull al abrir dashboard
    },
  },
};
```

### 1.3 Ventajas de Esta Arquitectura

| Aspecto | Beneficio |
|---------|-----------|
| Sin dependencias nuevas | No PostgreSQL, no Redis, no nuevo paquete |
| Reutiliza código | Dashboard HTTP server, WebSocket, SQLite |
| Flexible | Cualquier instancia puede ser hub |
| Portable | Un laptop puede ser hub temporal |
| Simple deployment | `npx e2e-runner dashboard` + config |

---

## 2. Seguridad - 4 Capas

### 2.1 Capa 1: Transport (TLS)

```javascript
// src/sync/tls.js
import https from 'https';
import fs from 'fs';

export function createSecureServer(httpHandler, config) {
  // Modo básico: TLS con cert autofirmado o Let's Encrypt
  if (!config.sync.hub.mtls) {
    return https.createServer({
      cert: fs.readFileSync(config.sync.hub.certPath),
      key: fs.readFileSync(config.sync.hub.keyPath),
      minVersion: 'TLSv1.3',
    }, httpHandler);
  }
  
  // Modo máximo: mTLS (mutual TLS)
  return https.createServer({
    cert: fs.readFileSync(config.sync.hub.certPath),
    key: fs.readFileSync(config.sync.hub.keyPath),
    ca: fs.readFileSync(config.sync.hub.caPath),
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.3',
  }, httpHandler);
}
```

**Niveles de seguridad:**

| Nivel | Transport | Cuándo usar |
|-------|-----------|-------------|
| 1. Básico | HTTP (solo localhost) | Desarrollo local |
| 2. Standard | HTTPS (cert normal) | Red interna confiable |
| 3. Máximo | HTTPS + mTLS | Internet, compliance |

### 2.2 Capa 2: Authentication

```
┌─────────────────────────────────────────────────────────────┐
│                    Auth Flow Simplificado                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Agent                                    Hub               │
│    │                                       │                │
│    │─── POST /api/sync/auth ──────────────▶│                │
│    │      {                                │                │
│    │        instance_id: 'laptop-juan',    │                │
│    │        api_key: 'sk_live_xxx...',     │  ← Validar     │
│    │        totp: '123456',                │  ← Validar     │
│    │        timestamp: 1699999999999       │  ← ±30 seg     │
│    │      }                                │                │
│    │                                       │                │
│    │◀── { token: 'jwt...', expires: 3600 } │                │
│    │                                       │                │
│    │─── GET /api/sync/pull ───────────────▶│                │
│    │      Authorization: Bearer jwt...     │                │
│    │                                       │                │
└─────────────────────────────────────────────────────────────┘
```

**Factores de autenticación:**

| Factor | Implementación | Propósito |
|--------|----------------|-----------|
| API Key | 256-bit random, almacenado hasheado | Identidad |
| TOTP | RFC 6238, ventana ±1 (30 seg) | Previene replay |
| Timestamp | ±30 segundos de tolerancia | Freshness |
| JWT | HS256, expira 1h | Sesión sin estado |

```javascript
// src/sync/auth.js
import crypto from 'crypto';
import { createHmac } from 'crypto';

// Generar API key para un nuevo agent
export function generateApiKey() {
  return 'sk_' + crypto.randomBytes(32).toString('base64url');
}

// Generar secreto TOTP (20 bytes = 160 bits, standard RFC 6238)
export function generateTotpSecret() {
  return crypto.randomBytes(20).toString('base32');
}

// Validar TOTP (con ventana ±1)
export function validateTotp(secret, code) {
  const now = Math.floor(Date.now() / 1000 / 30);
  for (const offset of [0, -1, 1]) {
    const expected = generateTotpCode(secret, now + offset);
    if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

// JWT simple (sin dependencias)
export function signJwt(payload, secret, expiresIn = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + expiresIn };
  
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const sig = createHmac('sha256', secret).update(unsigned).digest('base64url');
  
  return `${unsigned}.${sig}`;
}

export function verifyJwt(token, secret) {
  const [headerB64, payloadB64, sig] = token.split('.');
  const unsigned = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', secret).update(unsigned).digest('base64url');
  
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new Error('Invalid signature');
  }
  
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url'));
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  
  return payload;
}
```

### 2.3 Capa 3: Authorization

```javascript
// Roles simples
const ROLES = {
  admin: ['sync:*', 'instance:*', 'run:*', 'read:*'],
  member: ['sync:push', 'sync:pull', 'run:trigger', 'read:*'],
  readonly: ['sync:pull', 'read:*'],
};

// Middleware de autorización
function requirePermission(permission) {
  return (req, res, next) => {
    const { role } = req.auth;  // Del JWT
    const perms = ROLES[role] || [];
    
    const hasPermission = perms.some(p => 
      p === permission || 
      p.endsWith(':*') && permission.startsWith(p.slice(0, -1))
    );
    
    if (!hasPermission) {
      return jsonResponse(res, { error: 'Forbidden' }, 403);
    }
    next();
  };
}
```

### 2.4 Capa 4: Audit Log

```sql
-- Nueva tabla en SQLite existente
CREATE TABLE IF NOT EXISTS sync_audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT DEFAULT (datetime('now')),
  instance_id TEXT NOT NULL,
  action      TEXT NOT NULL,        -- 'auth', 'push', 'pull', 'register'
  resource    TEXT,                 -- 'run:123', 'project:my-app'
  status      TEXT NOT NULL,        -- 'success', 'denied', 'error'
  ip_address  TEXT,
  details     TEXT,                 -- JSON
  signature   TEXT                  -- HMAC para detectar tampering
);

CREATE INDEX IF NOT EXISTS idx_audit_instance ON sync_audit_log(instance_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON sync_audit_log(action, timestamp);
```

---

## 3. Schema SQLite (Adiciones)

```sql
-- ══════════════════════════════════════════════════════════════
-- TABLAS PARA MODO HUB
-- ══════════════════════════════════════════════════════════════

-- Instancias registradas (agents que se conectan a este hub)
CREATE TABLE IF NOT EXISTS sync_instances (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id     TEXT NOT NULL UNIQUE,      -- 'dev-laptop-juan'
  display_name    TEXT NOT NULL,
  hostname        TEXT,
  environment     TEXT DEFAULT 'development',
  api_key_hash    TEXT NOT NULL,             -- SHA-256 del API key
  totp_secret     TEXT NOT NULL,             -- Encriptado con master key
  role            TEXT DEFAULT 'member',
  status          TEXT DEFAULT 'pending',    -- 'pending', 'active', 'suspended'
  last_seen       TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  approved_at     TEXT,
  approved_by     INTEGER REFERENCES sync_instances(id)
);

-- Mapeo instancia ↔ proyecto
CREATE TABLE IF NOT EXISTS sync_instance_projects (
  instance_id     INTEGER REFERENCES sync_instances(id),
  project_id      INTEGER REFERENCES projects(id),
  local_cwd       TEXT,                      -- Path en esa instancia
  sync_enabled    INTEGER DEFAULT 1,
  last_push       TEXT,
  last_pull       TEXT,
  PRIMARY KEY (instance_id, project_id)
);

-- Runs sincronizados (de otras instancias)
-- Usa la tabla 'runs' existente + nuevas columnas:
ALTER TABLE runs ADD COLUMN sync_instance_id INTEGER REFERENCES sync_instances(id);
ALTER TABLE runs ADD COLUMN sync_origin TEXT;          -- 'local' | 'remote'
ALTER TABLE runs ADD COLUMN synced_at TEXT;

-- Screenshots remotos (referencia, no el archivo)
CREATE TABLE IF NOT EXISTS sync_screenshots (
  hash            TEXT PRIMARY KEY,
  instance_id     INTEGER REFERENCES sync_instances(id),
  storage_type    TEXT DEFAULT 'remote',     -- 'remote' | 'cached'
  cached_path     TEXT,                      -- Si se descargó
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ══════════════════════════════════════════════════════════════
-- TABLAS PARA MODO AGENT
-- ══════════════════════════════════════════════════════════════

-- Hub al que estamos conectados
CREATE TABLE IF NOT EXISTS sync_hub_connection (
  id              INTEGER PRIMARY KEY CHECK (id = 1),  -- Solo una fila
  hub_url         TEXT NOT NULL,
  instance_id     TEXT NOT NULL,
  jwt_token       TEXT,
  token_expires   TEXT,
  last_push       TEXT,
  last_pull       TEXT,
  status          TEXT DEFAULT 'disconnected'
);

-- Cola de sync pendiente (para cuando el hub no está disponible)
CREATE TABLE IF NOT EXISTS sync_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  operation       TEXT NOT NULL,             -- 'push_run', 'push_screenshot'
  payload         TEXT NOT NULL,             -- JSON
  created_at      TEXT DEFAULT (datetime('now')),
  attempts        INTEGER DEFAULT 0,
  last_attempt    TEXT,
  error           TEXT
);
```

---

## 4. API Endpoints (en Dashboard existente)

```javascript
// Nuevas rutas en src/dashboard.js

// ══════════════════════════════════════════════════════════════
// SYNC API (solo si mode = 'hub')
// ══════════════════════════════════════════════════════════════

// POST /api/sync/register — Registrar nuevo agent
// POST /api/sync/auth — Obtener JWT
// GET  /api/sync/status — Estado de conexión

// POST /api/sync/push — Agent envía runs al hub
// GET  /api/sync/pull — Agent obtiene runs de otras instancias

// GET  /api/sync/instances — Lista de instancias (admin)
// PATCH /api/sync/instances/:id — Aprobar/suspender instancia

// GET  /api/sync/screenshots/:hash — Obtener screenshot
// POST /api/sync/screenshots — Subir screenshot

// WebSocket: /ws con auth
// - Eventos: run.started, run.completed, instance.online, instance.offline
```

### 4.1 Flujo de Registro

```
┌─────────────────────────────────────────────────────────────┐
│                 Registro de Nueva Instancia                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Admin en Hub ejecuta:                                   │
│     $ npx e2e-runner sync add-instance                      │
│                                                             │
│     → Genera:                                               │
│       instance_id: laptop-juan-a3f2                         │
│       api_key: sk_live_Kj8x9...                             │
│       totp_secret: JBSWY3DPEHPK3PXP                         │
│                                                             │
│  2. Admin comparte credenciales con el usuario              │
│     (canal seguro: 1Password, Signal, etc.)                 │
│                                                             │
│  3. Usuario en Agent configura:                             │
│     $ export E2E_SYNC_API_KEY=sk_live_Kj8x9...              │
│     $ export E2E_SYNC_TOTP=JBSWY3DPEHPK3PXP                 │
│                                                             │
│     e2e.config.js:                                          │
│       sync: {                                               │
│         mode: 'agent',                                      │
│         agent: {                                            │
│           hubUrl: 'https://hub.example.com:8485',           │
│           instanceId: 'laptop-juan-a3f2',                   │
│         }                                                   │
│       }                                                     │
│                                                             │
│  4. Agent se conecta automáticamente al ejecutar tests      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Flujo de Sync

```
┌─────────────────────────────────────────────────────────────┐
│                      Push Flow                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Agent ejecuta tests → runner.js termina                    │
│         │                                                   │
│         ▼                                                   │
│  reporter.js → saveReport() → persistRun()                  │
│         │                                                   │
│         ▼                                                   │
│  sync/client.js → pushRun() [si autoSync: true]             │
│         │                                                   │
│         ├── 1. Obtener/refrescar JWT                        │
│         │                                                   │
│         ├── 2. POST /api/sync/push                          │
│         │      {                                            │
│         │        project: { name, slug },                   │
│         │        run: { ...datos del run },                 │
│         │        testResults: [...],                        │
│         │        screenshots: [{ hash, base64 }]            │
│         │      }                                            │
│         │                                                   │
│         └── 3. Si falla → agregar a sync_queue              │
│                                                             │
│  Hub recibe:                                                │
│         │                                                   │
│         ├── Validar JWT                                     │
│         ├── Deduplicar por (instance_id, run_id)            │
│         ├── Guardar en DB con sync_origin = 'remote'        │
│         ├── Guardar screenshots                             │
│         └── Broadcast WebSocket: run.synced                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Implementación por Fases

### Fase 1: Foundation (1 semana)

```
src/
├── sync/
│   ├── index.js          # Exports públicos
│   ├── auth.js           # API key, TOTP, JWT (sin deps)
│   ├── schema.js         # Migraciones SQLite para sync
│   └── middleware.js     # Auth middleware para dashboard
```

**Tareas:**
- [ ] Crear `src/sync/auth.js` — generación y validación de credenciales
- [ ] Crear `src/sync/schema.js` — migraciones para tablas sync_*
- [ ] Agregar config `sync` en `src/config.js`
- [ ] Agregar middleware auth en `src/dashboard.js`

### Fase 2: Hub Mode (1 semana)

```
src/
├── sync/
│   ├── hub-routes.js     # Endpoints /api/sync/*
│   └── hub-ws.js         # WebSocket auth + eventos
```

**Tareas:**
- [ ] POST /api/sync/auth — login con API key + TOTP
- [ ] POST /api/sync/push — recibir runs de agents
- [ ] GET /api/sync/pull — enviar runs a agents
- [ ] GET /api/sync/instances — listar instancias
- [ ] WebSocket con autenticación

### Fase 3: Agent Mode (1 semana)

```
src/
├── sync/
│   ├── client.js         # Cliente HTTP para conectar al hub
│   └── queue.js          # Cola offline
```

**Tareas:**
- [ ] Cliente que obtiene JWT y lo refresca
- [ ] `pushRun()` — llamado desde reporter.js
- [ ] Cola para sync cuando hub no disponible
- [ ] Retry con backoff exponencial

### Fase 4: CLI Commands (3-4 días)

```bash
# Comandos de administración
npx e2e-runner sync status              # Estado de conexión
npx e2e-runner sync add-instance        # Generar credenciales (hub)
npx e2e-runner sync list-instances      # Listar agents (hub)
npx e2e-runner sync approve <id>        # Aprobar agent pendiente
npx e2e-runner sync revoke <id>         # Revocar agent

# Comandos de operación
npx e2e-runner sync push                # Push manual
npx e2e-runner sync pull                # Pull manual
```

### Fase 5: Dashboard UX (1 semana)

**Cambios en templates/dashboard.html:**

```
┌─────────────────────────────────────────────────────────────┐
│  E2E Runner Dashboard                    [Instance: Hub ▼]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Instances Online: 3/4                                      │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐ │
│  │ This (Hub)  │ CI Server   │ QA Box      │ Juan Laptop │ │
│  │ ● Online    │ ● Online    │ ● Online    │ ○ Offline   │ │
│  └─────────────┴─────────────┴─────────────┴─────────────┘ │
│                                                             │
│  Filter: [All Instances ▼] [All Projects ▼] [Last 7 days]  │
│                                                             │
│  Recent Runs                                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ✓ my-app / login-flow    CI Server    2 min ago      │  │
│  │ ✗ my-app / checkout      This (Hub)   5 min ago      │  │
│  │ ✓ api-tests / users      QA Box       1 hour ago     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Fase 6: TLS/mTLS Opcional (3-4 días)

**Para máxima seguridad (opcional):**

```bash
# Generar CA y certificados
npx e2e-runner sync init-pki            # Genera CA
npx e2e-runner sync gen-cert <instance> # Genera cert para instancia
```

---

## 6. Archivos a Crear/Modificar

### Nuevos archivos:

```
src/sync/
├── index.js              # Exports: initSync, pushRun, pullRuns
├── auth.js               # Crypto: API keys, TOTP, JWT
├── schema.js             # SQLite migrations
├── middleware.js         # Express-style auth middleware
├── hub-routes.js         # Rutas /api/sync/* para hub
├── client.js             # Cliente HTTP para agents
└── queue.js              # Cola offline con retry
```

### Archivos a modificar:

```
src/config.js             # + sync config section
src/db.js                 # + llamar sync migrations
src/dashboard.js          # + montar rutas de sync si mode=hub
src/reporter.js           # + llamar pushRun() si autoSync
bin/cli.js                # + comandos sync
templates/dashboard.html  # + UI multi-instancia
```

---

## 7. Config Completa

```javascript
// e2e.config.js
export default {
  baseUrl: 'http://localhost:3000',
  poolUrl: 'ws://localhost:3100',
  
  sync: {
    // 'standalone' = sin sync (default)
    // 'hub' = acepta conexiones de agents
    // 'agent' = se conecta a un hub
    mode: 'hub',  
    
    // ─── Modo Hub ───────────────────────────────────
    hub: {
      // Puerto para sync API (null = usar dashboardPort)
      port: null,
      
      // HTTPS (recomendado para producción)
      tls: {
        enabled: true,
        certPath: '/etc/letsencrypt/live/hub.example.com/fullchain.pem',
        keyPath: '/etc/letsencrypt/live/hub.example.com/privkey.pem',
        
        // mTLS opcional (máxima seguridad)
        mtls: false,
        caPath: './certs/ca.pem',
      },
      
      // Política de registro
      allowRegistration: true,   // Permitir nuevos agents
      requireApproval: false,    // Aprobar automáticamente
      
      // Master key para encriptar TOTP secrets en DB
      // (leer de env var en producción)
      masterKeyEnv: 'E2E_SYNC_MASTER_KEY',
    },
    
    // ─── Modo Agent ─────────────────────────────────
    agent: {
      hubUrl: 'https://hub.example.com:8484',
      instanceId: 'dev-laptop-juan',
      displayName: 'Juan Dev Laptop',
      
      // Credenciales (siempre de env vars)
      apiKeyEnv: 'E2E_SYNC_API_KEY',
      totpSecretEnv: 'E2E_SYNC_TOTP',
      
      // Certificado cliente para mTLS (si hub lo requiere)
      tls: {
        certPath: './certs/agent.pem',
        keyPath: './certs/agent-key.pem',
        caPath: './certs/ca.pem',  // Para validar cert del hub
      },
      
      // Comportamiento
      autoSync: true,           // Push después de cada run
      pullOnDashboard: true,    // Pull al abrir dashboard
      offlineQueue: true,       // Encolar si hub no disponible
      queueRetryInterval: 60,   // Segundos entre reintentos
    },
  },
};
```

---

## 8. Seguridad Checklist

```
Pre-deployment (modo hub expuesto a internet):

[ ] TLS habilitado (certPath/keyPath configurados)
[ ] Master key generada y en env var (no en config)
[ ] API keys son 256-bit random
[ ] TOTP secrets encriptados en DB
[ ] JWT secret es 256-bit random
[ ] Rate limiting habilitado
[ ] Audit log habilitado
[ ] requireApproval: true para nuevos agents
[ ] Firewall: solo puerto 8484/8485 expuesto
[ ] Logs no contienen secrets

Opcional (máxima seguridad):
[ ] mTLS habilitado
[ ] Certificados con expiración corta (90 días)
[ ] IP allowlist para agents conocidos
```

---

## 9. Timeline

| Fase | Duración | Entregable |
|------|----------|------------|
| 1. Foundation | 1 semana | Auth, schema, config |
| 2. Hub Mode | 1 semana | Endpoints sync, WS auth |
| 3. Agent Mode | 1 semana | Cliente, queue, auto-push |
| 4. CLI | 3-4 días | Comandos sync |
| 5. Dashboard UX | 1 semana | Multi-instance UI |
| 6. TLS/mTLS | 3-4 días | Opcional, scripts PKI |

**Total: ~5-6 semanas** (vs 8 semanas del plan original con paquete separado)

---

## 10. Decisiones de Diseño

| Decisión | Elegido | Alternativa | Razón |
|----------|---------|-------------|-------|
| Base de datos | SQLite existente | PostgreSQL | Sin dependencias nuevas |
| Server HTTP | Dashboard existente | Nuevo server | Reutilizar código |
| JWT library | Implementación propia | jsonwebtoken | Sin dependencias |
| TOTP library | Implementación propia | otplib | Sin dependencias |
| WebSocket | websocket.js existente | socket.io | Sin dependencias |
| Storage screenshots | Filesystem | S3/R2 | Simple, futuro: agregar S3 |

---

## Próximos Pasos

1. Revisar y aprobar este plan
2. Decidir si empezar con TLS obligatorio o hacerlo opcional
3. Crear los archivos base de `src/sync/`
4. Implementar Fase 1 (foundation)
