# Multi-Pool Support

A single runner can distribute tests across multiple Chrome pools on different machines. `src/pool-manager.js` abstracts pool selection behind a **least-pressure** strategy. `poolUrl` (singular string) remains fully backwards compatible.

## Configuration

```js
// Single pool (unchanged)
export default { poolUrl: 'ws://localhost:3333' };

// Multi-pool — tests distribute across all pools
export default {
  poolUrls: ['ws://machine1:3333', 'ws://machine2:3333'],
  concurrency: 15,
};

// CI environment profile
export default {
  poolUrl: 'ws://localhost:3333',
  environments: {
    ci: { poolUrls: ['ws://ci-chrome1:3333', 'ws://ci-chrome2:3333'], concurrency: 10 },
  },
};
```

**CLI:** `e2e-runner run --all --pool-urls ws://m1:3333,ws://m2:3333`
**Env:** `CHROME_POOL_URLS=ws://m1:3333,ws://m2:3333` (comma-separated)

## Pool Selection Algorithm (`selectPool`)

1. Query all pools' `/pressure` in parallel
2. Filter to reachable pools with `running < maxConcurrent`
3. Sort by: lowest `running/maxConcurrent` → fewest queued → most free slots
4. Return best candidate URL
5. If all full, poll every 2s up to 60s, then pick least-pressured anyway

## Pool-Aware Queue

Before opening a browser connection, each worker checks the pool's `/pressure` endpoint. If the pool is at capacity, the worker waits (polling every 2s, up to 60s) for a free slot instead of piling requests into browserless's internal queue. This prevents memory pressure and SIGKILL of Chrome processes under heavy load.

## Failure Resilience

Dead pools are excluded from selection. `waitForAnyPool` succeeds if any pool responds. Failed connections trigger re-selection on the next worker.

## Config Normalization in `loadConfig()`

- If `poolUrls` array is set → `config._poolUrls = poolUrls`, `config.poolUrl = poolUrls[0]`
- Else → `config._poolUrls = [config.poolUrl]`
- `config.poolUrls` is deleted after normalization (use `config._poolUrls` internally)

## Key Functions (`src/pool-manager.js`)

| Function | Purpose |
|----------|---------|
| `getPoolUrls(config)` | Returns `config._poolUrls` (always an array) |
| `getAllPoolStatuses(poolUrls)` | Fetches `/pressure` from all pools in parallel |
| `getAggregatedPoolStatus(poolUrls)` | Combined view: `totalRunning`, `totalMaxConcurrent`, per-pool details |
| `waitForAnyPool(poolUrls)` | Blocks until at least one pool is reachable + available |
| `selectPool(poolUrls)` | Picks pool with lowest pressure ratio |
| `selectAndConnect(config)` | Convenience: selectPool + connectToPool in one call |
