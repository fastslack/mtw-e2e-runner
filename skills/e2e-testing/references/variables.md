# Variables Reference

Variables replace hardcoded sensitive values (JWT tokens, user IDs, API keys, etc.) in test JSON. Stored in SQLite (`~/.e2e-runner/dashboard.db`), scoped per project and per suite, editable from the dashboard UI.

## Syntax

```
{{var.TOKEN}}        → resolves from DB (suite scope → project scope)
{{env.MY_VAR}}       → resolves from process.env
{{param}}            → existing module param substitution (unchanged)
```

**Resolution priority:** suite vars > project vars > error if not found.

## Usage in Test JSON

```json
{ "$use": "auth-jwt", "params": { "token": "{{var.JWT_TOKEN}}", "orgId": "{{var.ORG_ID}}" } }
{ "type": "goto", "value": "/users/{{var.USER_ID}}/profile" }
{ "type": "gql", "value": "{ user(id: \"{{var.USER_ID}}\") { name } }" }
```

## MCP Tool (`e2e_vars`)

```
e2e_vars({ action: "set", key: "TOKEN", value: "abc123", scope: "project" })
e2e_vars({ action: "set", key: "TOKEN", value: "xyz789", scope: "auth" })  // suite-specific override
e2e_vars({ action: "list" })
e2e_vars({ action: "get", key: "TOKEN" })
e2e_vars({ action: "delete", key: "TOKEN", scope: "project" })
```

## Dashboard UI

Variables tab shows all variables grouped by scope. Values are masked by default (click to reveal). Inline edit, add new, and delete are supported.

## REST API

- `GET /api/db/projects/:id/variables` — list all vars for project
- `PUT /api/db/projects/:id/variables` — set a variable `{ scope, key, value }`
- `DELETE /api/db/projects/:id/variables/:scope/:key` — delete a variable
