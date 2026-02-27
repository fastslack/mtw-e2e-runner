# GraphQL Action Reference

The `gql` action executes GraphQL queries and mutations via browser `fetch`, with automatic auth token injection from `localStorage`. It also installs a `window.__e2eGql(query, vars)` helper for use in subsequent `evaluate` actions.

## Action Fields

| Action | Fields | Behavior |
|--------|--------|----------|
| `gql` | `value` (query string, required), `text` (variables JSON, optional), `selector` (assertion JS expression, optional) | Sends a GraphQL request to the configured endpoint. Reads auth token from localStorage. Throws on GraphQL errors. Returns `{ value: response.data }`. Stores full response on `window.__e2eLastGql`. |

## Config Fields

| Field | Default | Env Var | CLI Flag |
|-------|---------|---------|----------|
| `gqlEndpoint` | `/api/graphql` | `GQL_ENDPOINT` | `--gql-endpoint` |
| `gqlAuthHeader` | `Authorization` | `GQL_AUTH_HEADER` | `--gql-auth-header` |
| `gqlAuthKey` | `accessToken` | `GQL_AUTH_KEY` | `--gql-auth-key` |
| `gqlAuthPrefix` | `Bearer ` | `GQL_AUTH_PREFIX` | `--gql-auth-prefix` |

The endpoint path is appended to `location.origin`. The auth token is read from `localStorage[gqlAuthKey]` and sent as `gqlAuthHeader: gqlAuthPrefix + token`.

## Examples

### Basic query
```json
{ "type": "gql", "value": "{ users { id name } }" }
```

### With variables
```json
{ "type": "gql", "value": "query($id: ID, $orgId: ID) { orders(userId: $id, orgId: $orgId) { orderId status } }", "text": "{\"id\": \"abc-123\", \"orgId\": \"org-456\"}" }
```

### With inline assertion (selector field)
```json
// selector is a JS expression where `r` is the full GraphQL response
{ "type": "gql", "value": "{ pendingOrders(userId: \"abc-123\") { status } }", "selector": "r.data.pendingOrders.some(o => o.status === 'CANCELLED') ? 'FAIL: cancelled order found in pending list' : 'OK: all pending'" }
```

### Using the installed helper in evaluate
```json
// After any gql action runs, window.__e2eGql(query, vars) is available
{ "type": "gql", "value": "{ __typename }" }
{ "type": "evaluate", "value": "(async () => { const r = await window.__e2eGql('query { orders(status: [PROCESSING]) { orderId } }'); for (const o of r.data.orders) await window.__e2eGql('mutation($id: ID, $input: OrderInput) { updateOrder(orderId: $id, input: $input) { orderId } }', { id: o.orderId, input: { status: 'COMPLETED' } }); return 'Updated ' + r.data.orders.length; })()" }
```

## Custom Auth Header Config

If your API uses a non-standard auth header (e.g., `x-api-key` instead of `Authorization`):

```js
// e2e.config.js
export default {
  gqlEndpoint: '/api/graphql',
  gqlAuthHeader: 'x-api-key',   // custom header name
  gqlAuthKey: 'apiToken',       // localStorage key to read from
  gqlAuthPrefix: '',             // no 'Bearer ' prefix — raw token
};
```
