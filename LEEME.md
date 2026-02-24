<p align="right">
  <a href="README.md">English</a> · <strong>Español</strong>
</p>

<h1 align="center">@matware/e2e-runner</h1>

<p align="center">
  <strong>El test runner E2E con IA nativa que escribe, ejecuta y depura tests por ti.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/@matware/e2e-runner?color=blue" alt="npm version" />
  <img src="https://img.shields.io/node/v/@matware/e2e-runner" alt="node version" />
  <img src="https://img.shields.io/npm/l/@matware/e2e-runner" alt="license" />
  <img src="https://img.shields.io/badge/MCP-compatible-green" alt="MCP compatible" />
  <img src="https://img.shields.io/badge/AI--native-Claude%20Code-blueviolet" alt="AI native" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/fastslack/mtw-e2e-runner/main/docs/screenshots/blog-dashboard-live-running.png" alt="E2E Runner Dashboard - Ejecución en vivo" width="800" />
</p>

---

**E2E Runner** es un framework de testing de navegador sin código donde los tests son archivos JSON planos — sin scripts de Playwright, sin boilerplate de Cypress, sin framework que aprender. Definí qué hacer clic, qué escribir y qué verificar, y el runner lo ejecuta en paralelo contra un pool compartido de Chrome.

Pero lo que realmente lo diferencia es su **integración profunda con IA**. Con un [servidor MCP](https://modelcontextprotocol.io/) integrado, Claude Code puede crear tests desde una conversación, ejecutarlos, leer los resultados, capturar screenshots e incluso verificar visualmente que las páginas se ven correctas — todo sin salir del chat. Pegá la URL de un issue de GitHub y recibí un test ejecutable. Así de simple.

### Qué incluye

🧪 **Tests sin código** — Archivos JSON que cualquier persona de tu equipo puede leer y escribir. Sin JavaScript, sin compilación, sin dependencia de framework.

🤖 **Testing con IA** — Claude Code crea, ejecuta y depura tests nativamente a través de 12 herramientas MCP. Pedile que "testee el flujo de checkout" y construye el JSON, lo ejecuta y te reporta el resultado.

🐛 **Pipeline Issue-to-Test** — Pegá una URL de issue de GitHub o GitLab. El runner lo busca, genera tests E2E, los ejecuta y te dice: *bug confirmado* o *no reproducible*.

👁️ **Verificación visual** — Describí cómo debería verse la página en texto plano. La IA captura un screenshot y juzga si pasa o falla contra tu descripción. Sin configurar pixel-diffing.

🧠 **Sistema de aprendizaje** — Rastrea la estabilidad de los tests entre ejecuciones. Detecta tests flaky, selectores inestables, APIs lentas y patrones de error — y después muestra insights accionables.

⚡ **Ejecución paralela** — Ejecutá N tests simultáneamente contra un pool compartido de Chrome (browserless/chrome). Modo serial disponible para tests que comparten estado.

📊 **Dashboard en tiempo real** — Vista de ejecución en vivo, historial de ejecuciones con gráficos de tasa de éxito, galería de screenshots con búsqueda por hash, logs de requests de red expandibles.

🔁 **Reintentos inteligentes** — Reintentos a nivel de test y de acción con delays configurables. Los tests flaky se detectan y marcan automáticamente.

📦 **Módulos reutilizables** — Extraé flujos comunes (login, navegación, setup) en módulos parametrizados y referencialos con `$use`.

🏗️ **Listo para CI** — Salida JUnit XML, código de salida 1 ante fallos, screenshots de error automáticos. Ejemplo listo para GitHub Actions incluido.

🌐 **Multi-proyecto** — Un dashboard agrega resultados de tests de todos tus proyectos. Un pool de Chrome los sirve a todos.

🐳 **Portable** — Chrome corre en Docker, los tests son archivos JSON en tu repo. Funciona en cualquier máquina con Node.js y Docker.

### Esto es un test

```json
[
  {
    "name": "flujo-login",
    "actions": [
      { "type": "goto", "value": "/login" },
      { "type": "type", "selector": "#email", "value": "usuario@test.com" },
      { "type": "type", "selector": "#password", "value": "secreto" },
      { "type": "click", "text": "Iniciar Sesión" },
      { "type": "assert_text", "text": "Bienvenido" },
      { "type": "screenshot", "value": "logueado.png" }
    ]
  }
]
```

Sin imports. Sin `describe`/`it`. Sin paso de compilación. Solo un archivo JSON que describe lo que hace un usuario — y el runner lo hace realidad.

---

## Inicio Rápido

**Una línea** (requiere Node.js >= 20 y Docker):

```bash
curl -fsSL https://raw.githubusercontent.com/fastslack/mtw-e2e-runner/main/scripts/quickstart.sh | bash
```

**Paso a paso:**

```bash
# 1. Instalar
npm install --save-dev @matware/e2e-runner

# 2. Crear estructura del proyecto
npx e2e-runner init

# 3. Iniciar pool de Chrome (requiere Docker)
npx e2e-runner pool start

# 4. Ejecutar todos los tests
npx e2e-runner run --all

# 5. Abrir el dashboard
npx e2e-runner dashboard
```

**Agregar a Claude Code** (una vez, disponible en todos los proyectos):

```bash
claude mcp add --transport stdio --scope user e2e-runner \
  -- npx -y -p @matware/e2e-runner e2e-runner-mcp
```

---

## Formato de Tests

Cada archivo `.json` en `e2e/tests/` contiene un array de tests. Cada test tiene un `name` y `actions` secuenciales:

```json
[
  {
    "name": "carga-homepage",
    "actions": [
      { "type": "goto", "value": "/" },
      { "type": "wait", "selector": ".hero" },
      { "type": "assert_text", "text": "Bienvenido" },
      { "type": "assert_url", "value": "/" },
      { "type": "screenshot", "value": "homepage.png" }
    ]
  }
]
```

Los archivos de suite pueden tener prefijos numéricos para ordenamiento (`01-auth.json`, `02-dashboard.json`). El flag `--suite` matchea con o sin prefijo, así que `--suite auth` encuentra `01-auth.json`.

### Acciones Disponibles

| Acción | Campos | Descripción |
|--------|--------|-------------|
| `goto` | `value` | Navegar a URL (relativa a `baseUrl` o absoluta) |
| `click` | `selector` o `text` | Click por selector CSS o contenido de texto visible |
| `type` / `fill` | `selector`, `value` | Limpiar campo y escribir texto |
| `wait` | `selector`, `text`, o `value` (ms) | Esperar elemento, texto o delay fijo |
| `screenshot` | `value` (nombre de archivo) | Capturar un screenshot |
| `select` | `selector`, `value` | Seleccionar una opción de dropdown |
| `clear` | `selector` | Limpiar un campo de input |
| `press` | `value` | Presionar una tecla (`Enter`, `Tab`, etc.) |
| `scroll` | `selector` o `value` (px) | Scroll a elemento o por cantidad de píxeles |
| `hover` | `selector` | Hover sobre un elemento |
| `evaluate` | `value` | Ejecutar JavaScript en el contexto del navegador |
| `navigate` | `value` | Navegación del navegador (`back`, `forward`, `reload`) |
| `clear_cookies` | — | Limpiar todas las cookies de la página actual |

### Aserciones

| Acción | Campos | Descripción |
|--------|--------|-------------|
| `assert_text` | `text` | Verificar que el texto existe en cualquier parte de la página (substring) |
| `assert_element_text` | `selector`, `text`, opcional `value: "exact"` | Verificar que el texto del elemento contiene (o coincide exactamente con) el texto esperado |
| `assert_url` | `value` | Verificar la URL actual. Los paths (`/dashboard`) comparan solo contra el pathname |
| `assert_visible` | `selector` | Verificar que el elemento existe y es visible |
| `assert_not_visible` | `selector` | Verificar que el elemento está oculto o no existe |
| `assert_attribute` | `selector`, `value` | Verificar atributo: `"type=email"` para valor, `"disabled"` para existencia |
| `assert_class` | `selector`, `value` | Verificar que el elemento tiene una clase CSS |
| `assert_input_value` | `selector`, `value` | Verificar que el `.value` de input/select/textarea contiene el texto |
| `assert_matches` | `selector`, `value` (regex) | Verificar que el texto del elemento coincide con un patrón regex |
| `assert_count` | `selector`, `value` | Verificar cantidad de elementos: exacto (`"5"`), u operadores (`">3"`, `">=1"`, `"<10"`) |
| `assert_no_network_errors` | — | Falla si alguna request de red falló (ej. `ERR_CONNECTION_REFUSED`) |
| `get_text` | `selector` | Extraer texto del elemento (no es aserción, nunca falla). Resultado: `{ value: "..." }` |

### Click por Texto

Cuando `click` usa `text` en vez de `selector`, busca en elementos interactivos y de contenido comunes:

```
button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"],
[role="listitem"], div[class*="cursor"], span, li, td, th, label, p, h1-h6
```

```json
{ "type": "click", "text": "Iniciar Sesión" }
```

---

## Reintentos

### Reintento a Nivel de Test

Reintentar un test completo ante fallo. Configurar globalmente o por test:

```json
{ "name": "test-flaky", "retries": 3, "timeout": 15000, "actions": [...] }
```

Los tests que pasan después de reintentar se marcan como **flaky** en el reporte y el sistema de aprendizaje.

### Reintento a Nivel de Acción

Reintentar una acción individual sin re-ejecutar el test completo. Útil para clicks y waits sensibles al timing:

```json
{ "type": "click", "selector": "#btn-dinamico", "retries": 3 }
{ "type": "wait", "selector": ".carga-lazy", "retries": 2 }
```

Configurar globalmente: `actionRetries` en config, `--action-retries <n>` en CLI, o variable de entorno `ACTION_RETRIES`. Delay entre reintentos: `actionRetryDelay` (default 500ms).

---

## Tests Seriales

Los tests que comparten estado (ej. dos tests modificando el mismo registro) pueden competir al ejecutarse en paralelo. Marcalos como seriales:

```json
{ "name": "crear-paciente", "serial": true, "actions": [...] }
{ "name": "verificar-lista-pacientes", "serial": true, "actions": [...] }
```

Los tests seriales se ejecutan uno a la vez **después** de que todos los tests paralelos terminen — previniendo interferencia sin ralentizar los tests independientes.

---

## Módulos Reutilizables

Extraé flujos comunes en módulos parametrizados:

```json
// e2e/modules/auth.json
{
  "$module": "auth-jwt",
  "description": "Inyectar token JWT en localStorage",
  "params": {
    "token": { "required": true, "description": "Token JWT" },
    "storageKey": { "default": "accessToken" }
  },
  "actions": [
    { "type": "evaluate", "value": "localStorage.setItem('{{storageKey}}', '{{token}}')" },
    { "type": "goto", "value": "/dashboard" }
  ]
}
```

Usar en tests:

```json
{
  "name": "carga-dashboard",
  "actions": [
    { "$use": "auth-jwt", "params": { "token": "eyJhbG..." } },
    { "type": "assert_text", "text": "Dashboard" }
  ]
}
```

Los módulos soportan validación de parámetros (los requeridos fallan rápido), bloques condicionales (`{{#param}}...{{/param}}`), composición anidada y detección de ciclos.

---

## Patrones de Exclusión

Excluir tests exploratorios o borradores de las ejecuciones con `--all`:

```js
// e2e.config.js
export default {
  exclude: ['explore-*', 'debug-*', 'draft-*'],
};
```

Las ejecuciones de suites individuales (`--suite`) no son afectadas por los patrones de exclusión.

---

## Verificación Visual

Describí cómo debería verse la página — la IA juzga si pasa o falla a partir de screenshots:

```json
{
  "name": "carga-dashboard",
  "expect": "Lista de pacientes con al menos 3 filas, sin mensajes de error, sidebar con links de navegación",
  "actions": [
    { "type": "goto", "value": "/dashboard" },
    { "type": "wait", "selector": ".patient-list" }
  ]
}
```

Después de que las acciones del test terminan, el runner auto-captura un screenshot de verificación. La respuesta MCP incluye el hash del screenshot — Claude Code lo recupera y verifica visualmente contra tu descripción `expect`. No requiere API key.

---

## Issue-to-Test

Convertí issues de GitHub y GitLab en tests E2E ejecutables. Pegá una URL de issue y obtené tests ejecutables — automáticamente.

**Cómo funciona:**

1. **Buscar** — Obtiene los detalles del issue (título, cuerpo, labels) vía CLI `gh` o `glab`
2. **Generar** — La IA crea acciones JSON de test basadas en la descripción del issue
3. **Ejecutar** — Opcionalmente ejecuta los tests inmediatamente para verificar si un bug es reproducible

```bash
# Buscar y mostrar
e2e-runner issue https://github.com/owner/repo/issues/42

# Generar un archivo de test vía Claude API
e2e-runner issue https://github.com/owner/repo/issues/42 --generate

# Generar + ejecutar + reportar
e2e-runner issue https://github.com/owner/repo/issues/42 --verify
# -> "BUG CONFIRMED" o "NOT REPRODUCIBLE"
```

En Claude Code, simplemente pedí:
> "Buscá el issue #42 y creá tests E2E para verificarlo"

**Lógica de verificación de bugs:** Los tests generados verifican el comportamiento **correcto**. Si el test falla = bug confirmado. Si todos los tests pasan = no reproducible.

**Autenticación:** GitHub requiere CLI `gh`, GitLab requiere CLI `glab`. GitLab self-hosted es soportado.

---

## Sistema de Aprendizaje

El runner aprende de cada ejecución — construyendo conocimiento sobre tu suite de tests con el tiempo.

Consultá insights a través de la herramienta MCP `e2e_learnings`:

| Consulta | Retorna |
|----------|---------|
| `summary` | Resumen de salud completo: tasa de éxito, tests flaky, selectores inestables, problemas de API |
| `flaky` | Tests que pasan solo después de reintentos |
| `selectors` | Selectores CSS con alta tasa de fallo |
| `pages` | Páginas con errores de consola, fallos de red, problemas de tiempo de carga |
| `apis` | Endpoints de API con tasas de error y latencia (auto-normalizado: UUIDs, hashes, IDs) |
| `errors` | Patrones de error más frecuentes, categorizados |
| `trends` | Tasa de éxito en el tiempo (cambia automáticamente a vista por hora cuando todos los datos son del mismo día) |
| `test:<nombre>` | Historial detallado de un test específico |
| `page:<path>` | Historial detallado de una página específica |
| `selector:<valor>` | Historial detallado de un selector específico |

Los aprendizajes se almacenan en SQLite (`~/.e2e-runner/dashboard.db`) y opcionalmente se exportan a un grafo de conocimiento Neo4j para análisis basado en relaciones.

Un reporte markdown (`e2e/learnings.md`) se auto-genera después de cada ejecución.

---

## Dashboard Web

Interfaz en tiempo real para ejecutar tests, ver resultados, screenshots y logs de red.

```bash
e2e-runner dashboard                  # Iniciar en puerto por defecto 8484
e2e-runner dashboard --port 9090      # Puerto personalizado
```

### Ejecución en Vivo

Monitoreá tests en tiempo real con progreso paso a paso, duraciones y cantidad de workers activos.

<p align="center">
  <img src="https://raw.githubusercontent.com/fastslack/mtw-e2e-runner/main/docs/screenshots/blog-dashboard-live-running.png" alt="Dashboard - Ejecución de tests en vivo" width="800" />
</p>

### Suites de Tests

Explorá todas las suites de tests de múltiples proyectos. Ejecutá una suite individual o todos los tests con un click.

<p align="center">
  <img src="https://raw.githubusercontent.com/fastslack/mtw-e2e-runner/main/docs/screenshots/blog-dashboard-suites.png" alt="Dashboard - Grilla de suites de tests" width="800" />
</p>

### Historial de Ejecuciones

Seguí las tendencias de tasa de éxito con el gráfico integrado. Hacé click en cualquier fila para expandir el detalle completo con resultados por test, hashes de screenshots y errores.

<p align="center">
  <img src="https://raw.githubusercontent.com/fastslack/mtw-e2e-runner/main/docs/screenshots/blog-dashboard-runs.png" alt="Dashboard - Historial de ejecuciones" width="800" />
</p>

### Detalle de Ejecución

Vista expandida con badges PASS/FAIL, thumbnails de screenshots con hashes copiables (`ss:77c28b5a`), errores de consola formateados y logs de requests de red.

<p align="center">
  <img src="https://raw.githubusercontent.com/fastslack/mtw-e2e-runner/main/docs/screenshots/blog-dashboard-run-detail.png" alt="Dashboard - Detalle de ejecución" width="800" />
</p>

### Galería de Screenshots

Explorá todos los screenshots capturados con búsqueda por hash. Incluye screenshots de acciones, screenshots de error y capturas de verificación.

<p align="center">
  <img src="https://raw.githubusercontent.com/fastslack/mtw-e2e-runner/main/docs/screenshots/blog-dashboard-screenshots-gallery.png" alt="Dashboard - Galería de screenshots" width="800" />
</p>

### Estado del Pool

Monitoreá la salud del pool de Chrome: slots disponibles, sesiones activas, presión de memoria.

<p align="center">
  <img src="https://raw.githubusercontent.com/fastslack/mtw-e2e-runner/main/docs/screenshots/blog-dashboard-pool-status.png" alt="Dashboard - Estado del pool" width="800" />
</p>

---

## Captura de Screenshots

Capturá screenshots de cualquier URL bajo demanda — sin necesidad de suite de tests:

```bash
e2e-runner capture https://example.com
e2e-runner capture https://example.com --full-page --selector ".loaded" --delay 2000
```

Vía MCP, la herramienta `e2e_capture` soporta `authToken` y `authStorageKey` para páginas autenticadas — inyecta el token en localStorage antes de navegar.

Cada screenshot recibe un hash determinístico (`ss:a3f2b1c9`). Usá `e2e_screenshot` para recuperar cualquier screenshot por hash — devuelve la imagen con metadata (nombre del test, paso, tipo).

---

## Integración con Claude Code (MCP)

El paquete incluye un [servidor MCP](https://modelcontextprotocol.io/) integrado que le da a Claude Code acceso nativo al test runner.

**Instalar una vez** (disponible en todos los proyectos):

```bash
claude mcp add --transport stdio --scope user e2e-runner \
  -- npx -y -p @matware/e2e-runner e2e-runner-mcp
```

### Herramientas MCP

| Herramienta | Descripción |
|-------------|-------------|
| `e2e_run` | Ejecutar tests: todas las suites, por nombre o por archivo. Soporta overrides de `concurrency`, `baseUrl`, `retries`, `failOnNetworkError`. Retorna resultados de verificación si los tests tienen `expect`. |
| `e2e_list` | Listar suites de tests disponibles con nombres y cantidades |
| `e2e_create_test` | Crear un nuevo archivo JSON de test con nombre, tests y hooks opcionales |
| `e2e_create_module` | Crear un módulo reutilizable con acciones parametrizadas |
| `e2e_pool_status` | Verificar disponibilidad del pool de Chrome, sesiones activas, capacidad |
| `e2e_screenshot` | Recuperar un screenshot por hash (`ss:a3f2b1c9`). Retorna imagen + metadata |
| `e2e_capture` | Capturar screenshot de cualquier URL. Soporta `authToken`, `fullPage`, `selector`, `delay` |
| `e2e_dashboard_start` | Iniciar el dashboard web |
| `e2e_dashboard_stop` | Detener el dashboard web |
| `e2e_issue` | Buscar issue de GitHub/GitLab y generar tests. `mode: "prompt"` o `mode: "verify"` |
| `e2e_learnings` | Consultar el sistema de aprendizaje: `summary`, `flaky`, `selectors`, `pages`, `apis`, `errors`, `trends` |
| `e2e_neo4j` | Gestionar contenedor Neo4j de grafo de conocimiento: `start`, `stop`, `status` |

> **Nota:** Pool start/stop son solo CLI (`e2e-runner pool start|stop`) — no se exponen vía MCP para evitar matar sesiones activas.

### Qué Podés Pedirle a Claude Code

> "Ejecutá todos los tests E2E"
> "Creá un test que verifique el flujo de checkout"
> "¿Qué tests son flaky? Mostrá el resumen de aprendizaje"
> "Capturá un screenshot de /dashboard con autenticación"
> "Buscá el issue #42 y creá tests para verificarlo"
> "¿Cuál es la tasa de error de la API en los últimos 7 días?"

---

## Manejo de Errores de Red

### Aserción Explícita

Colocá `assert_no_network_errors` después de cargas de página críticas:

```json
{ "type": "goto", "value": "/dashboard" },
{ "type": "wait", "selector": ".loaded" },
{ "type": "assert_no_network_errors" }
```

### Flag Global

Configurá `failOnNetworkError: true` para fallar automáticamente cualquier test con errores de red:

```bash
e2e-runner run --all --fail-on-network-error
```

Cuando está deshabilitado (por defecto), el runner igual recolecta y reporta errores de red — la respuesta MCP incluye un warning cuando los tests pasan pero tienen errores de red.

### Logging Completo de Red

Todas las requests XHR/fetch se capturan con: URL, método, status, duración, headers de request/response y cuerpo de response (truncado a 50KB). Visible en el dashboard con filas de detalle de request expandibles.

---

## Hooks

Ejecutá acciones en puntos del ciclo de vida. Definir globalmente en config o por suite:

```json
{
  "hooks": {
    "beforeAll": [{ "type": "goto", "value": "/setup" }],
    "beforeEach": [{ "type": "goto", "value": "/" }],
    "afterEach": [{ "type": "screenshot", "value": "despues.png" }],
    "afterAll": []
  },
  "tests": [...]
}
```

> **Importante:** `beforeAll` se ejecuta en una página de navegador separada que se cierra antes de que empiecen los tests. Usá `beforeEach` para estado que los tests necesitan (cookies, localStorage, tokens de auth).

---

## CLI

```bash
# Ejecutar tests
e2e-runner run --all                  # Todas las suites
e2e-runner run --suite auth           # Suite individual
e2e-runner run --tests path/to.json   # Archivo específico
e2e-runner run --inline '<json>'      # JSON inline

# Gestión del pool (solo CLI, no MCP)
e2e-runner pool start                 # Iniciar contenedor Chrome
e2e-runner pool stop                  # Detener contenedor Chrome
e2e-runner pool status                # Verificar salud del pool

# Issue-to-test
e2e-runner issue <url>                # Buscar issue
e2e-runner issue <url> --generate     # Generar test vía IA
e2e-runner issue <url> --verify       # Generar + ejecutar + reportar

# Dashboard
e2e-runner dashboard                  # Iniciar dashboard web

# Otros
e2e-runner list                       # Listar suites disponibles
e2e-runner capture <url>              # Screenshot bajo demanda
e2e-runner init                       # Crear estructura del proyecto
```

### Opciones de CLI

| Flag | Default | Descripción |
|------|---------|-------------|
| `--base-url <url>` | `http://host.docker.internal:3000` | URL base de la aplicación |
| `--pool-url <ws>` | `ws://localhost:3333` | URL WebSocket del pool de Chrome |
| `--concurrency <n>` | `3` | Workers de test paralelos |
| `--retries <n>` | `0` | Reintentar tests fallidos N veces |
| `--action-retries <n>` | `0` | Reintentar acciones fallidas N veces |
| `--test-timeout <ms>` | `60000` | Timeout por test |
| `--timeout <ms>` | `10000` | Timeout default de acción |
| `--output <format>` | `json` | Reporte: `json`, `junit`, `both` |
| `--env <name>` | `default` | Perfil de entorno |
| `--fail-on-network-error` | `false` | Fallar tests con errores de red |
| `--project-name <name>` | nombre del dir | Nombre display del proyecto |

---

## Configuración

Creá `e2e.config.js` en la raíz de tu proyecto:

```js
export default {
  baseUrl: 'http://host.docker.internal:3000',
  concurrency: 4,
  retries: 2,
  actionRetries: 1,
  testTimeout: 30000,
  outputFormat: 'both',
  failOnNetworkError: true,
  exclude: ['explore-*', 'debug-*'],

  hooks: {
    beforeEach: [{ type: 'goto', value: '/' }],
  },

  environments: {
    staging: { baseUrl: 'https://staging.example.com' },
    production: { baseUrl: 'https://example.com', concurrency: 5 },
  },
};
```

### Prioridad de Configuración (la más alta gana)

1. Flags de CLI
2. Variables de entorno
3. Archivo de config (`e2e.config.js` o `e2e.config.json`)
4. Defaults

Cuando se usa `--env <nombre>`, el perfil correspondiente sobreescribe todo.

---

## CI/CD

### JUnit XML

```bash
e2e-runner run --all --output junit
```

### GitHub Actions

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx e2e-runner pool start
      - run: npx e2e-runner run --all --output junit
      - uses: mikepenz/action-junit-report@v4
        if: always()
        with:
          report_paths: e2e/screenshots/junit.xml
```

---

## API Programática

```js
import { createRunner } from '@matware/e2e-runner';

const runner = await createRunner({ baseUrl: 'http://localhost:3000' });

const report = await runner.runAll();
const report = await runner.runSuite('auth');
const report = await runner.runFile('e2e/tests/login.json');
const report = await runner.runTests([
  { name: 'check-rapido', actions: [{ type: 'goto', value: '/' }] },
]);
```

---

## Requisitos

- **Node.js** >= 20
- **Docker** (para el pool de Chrome)

## Licencia

Copyright 2025 Matias Aguirre (fastslack)

Licenciado bajo la Licencia Apache, Versión 2.0. Ver [LICENSE](LICENSE) para más detalles.
