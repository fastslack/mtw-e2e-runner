/**
 * Pool Manager — multi-pool selection and distribution.
 *
 * Abstracts pool selection behind a least-pressure strategy.
 * When multiple pools are configured, tests are distributed across
 * all available Chrome capacity. Single-pool setups work identically.
 *
 * Uses a local pending counter to avoid "thundering herd" — when many
 * workers call selectPool() simultaneously, the remote /pressure endpoint
 * hasn't updated yet. The pending map tracks selections locally so
 * subsequent calls factor in connections that are in-flight.
 */

import { getPoolStatus, connectToPool } from './pool.js';
import { log, colors as C } from './logger.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Local pending counter — tracks connections selected but not yet
 * reflected in the pool's /pressure endpoint. Prevents all workers
 * from picking the same pool when they query simultaneously.
 */
const pendingConnections = new Map();

export function trackPending(poolUrl) {
  pendingConnections.set(poolUrl, (pendingConnections.get(poolUrl) || 0) + 1);
}

export function releasePending(poolUrl) {
  const current = pendingConnections.get(poolUrl) || 0;
  if (current > 1) {
    pendingConnections.set(poolUrl, current - 1);
  } else {
    pendingConnections.delete(poolUrl);
  }
}

function getPending(poolUrl) {
  return pendingConnections.get(poolUrl) || 0;
}

/** Returns the normalized pool URL array from config. Always an array, even for single pool. */
export function getPoolUrls(config) {
  return config._poolUrls || [config.poolUrl];
}

/** Fetches /pressure from all pools in parallel. Returns [{ url, status, error }]. */
export async function getAllPoolStatuses(poolUrls) {
  return Promise.all(poolUrls.map(async (url) => {
    try {
      const status = await getPoolStatus(url);
      return { url, status, error: null };
    } catch (error) {
      return { url, status: null, error: error.message };
    }
  }));
}

/** Combined view across all pools: totalRunning, totalMaxConcurrent, per-pool details. */
export async function getAggregatedPoolStatus(poolUrls) {
  const results = await getAllPoolStatuses(poolUrls);

  let totalRunning = 0;
  let totalMaxConcurrent = 0;
  let totalQueued = 0;
  let availableCount = 0;

  const pools = results.map(({ url, status, error }) => {
    if (error || !status) {
      return { url, available: false, error: error || 'unreachable', running: 0, maxConcurrent: 0, queued: 0, sessions: [] };
    }
    totalRunning += status.running;
    totalMaxConcurrent += status.maxConcurrent;
    totalQueued += status.queued;
    if (status.available) availableCount++;
    return { url, ...status };
  });

  return {
    totalRunning,
    totalMaxConcurrent,
    totalQueued,
    availableCount,
    totalPools: poolUrls.length,
    pools,
  };
}

/** Blocks until at least one pool is reachable and available. */
export async function waitForAnyPool(poolUrls, maxWaitMs = 30000) {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const results = await getAllPoolStatuses(poolUrls);
    const available = results.find(r => r.status?.available);
    if (available) return available.status;

    const reachable = results.filter(r => r.status && !r.error);
    if (reachable.length > 0) {
      log('⏳', `${C.dim}Pool(s) busy (${reachable.length}/${poolUrls.length} reachable), waiting...${C.reset}`);
    } else {
      log('⏳', `${C.dim}No pools reachable yet (0/${poolUrls.length}), waiting...${C.reset}`);
    }

    await sleep(2000);
  }

  throw new Error(`No Chrome Pool available after ${maxWaitMs / 1000}s. Verify containers are running.`);
}

/**
 * Picks the pool with the lowest pressure ratio.
 *
 * Algorithm:
 * 1. Query all pools' /pressure in parallel
 * 2. Add local pending count to each pool's running total
 * 3. Filter to reachable pools with (running + pending) < maxConcurrent
 * 4. Sort by: lowest effective pressure → fewest queued → most free slots
 * 5. Track selection in pending counter, return best candidate URL
 * 6. If all full, poll every 2s up to 60s, then pick least-pressured anyway
 */
export async function selectPool(poolUrls, pollIntervalMs = 2000, maxWaitMs = 60000) {
  // Fast path: single pool
  if (poolUrls.length === 1) {
    await waitForSlotOnPool(poolUrls[0], pollIntervalMs, maxWaitMs);
    trackPending(poolUrls[0]);
    return poolUrls[0];
  }

  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const results = await getAllPoolStatuses(poolUrls);
    const candidates = results
      .filter(r => r.status && !r.error && r.status.available)
      .map(r => {
        const pending = getPending(r.url);
        const effectiveRunning = r.status.running + pending;
        return {
          url: r.url,
          running: r.status.running,
          pending,
          effectiveRunning,
          maxConcurrent: r.status.maxConcurrent,
          queued: r.status.queued,
          pressure: r.status.maxConcurrent > 0 ? effectiveRunning / r.status.maxConcurrent : 1,
          freeSlots: r.status.maxConcurrent - effectiveRunning,
        };
      })
      .filter(c => c.effectiveRunning < c.maxConcurrent);

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        if (a.pressure !== b.pressure) return a.pressure - b.pressure;
        if (a.queued !== b.queued) return a.queued - b.queued;
        return b.freeSlots - a.freeSlots;
      });
      const chosen = candidates[0].url;
      trackPending(chosen);
      return chosen;
    }

    // All full — check if any are reachable
    const reachable = results.filter(r => r.status && !r.error);
    if (reachable.length > 0) {
      log('⏳', `${C.dim}All pools at capacity (${reachable.length}/${poolUrls.length} reachable), waiting for slot...${C.reset}`);
    }

    await sleep(pollIntervalMs);
  }

  // Timeout — pick the least-pressured pool anyway (let connectToPool deal with it)
  const results = await getAllPoolStatuses(poolUrls);
  const reachable = results
    .filter(r => r.status && !r.error)
    .sort((a, b) => {
      const pendA = getPending(a.url);
      const pendB = getPending(b.url);
      const pA = a.status.maxConcurrent > 0 ? (a.status.running + pendA) / a.status.maxConcurrent : 1;
      const pB = b.status.maxConcurrent > 0 ? (b.status.running + pendB) / b.status.maxConcurrent : 1;
      return pA - pB;
    });

  if (reachable.length > 0) {
    log('⚠️', `${C.yellow}Waited ${maxWaitMs / 1000}s for pool slot, proceeding with least-pressured pool${C.reset}`);
    const chosen = reachable[0].url;
    trackPending(chosen);
    return chosen;
  }

  // All unreachable — return first and let connectToPool error
  return poolUrls[0];
}

/** Convenience: selectPool + connectToPool in one call. */
export async function selectAndConnect(config) {
  const poolUrls = getPoolUrls(config);
  const chosenUrl = await selectPool(poolUrls);
  return connectToPool(chosenUrl, config.connectRetries, config.connectRetryDelay);
}

/** Waits until a single pool has capacity (replaces the old waitForSlot from runner.js). */
async function waitForSlotOnPool(poolUrl, pollIntervalMs = 2000, maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const status = await getPoolStatus(poolUrl);
      if (status.available && status.running < status.maxConcurrent) {
        return;
      }
      log('⏳', `${C.dim}Pool at capacity (${status.running}/${status.maxConcurrent}, ${status.queued} queued), waiting for slot...${C.reset}`);
    } catch {
      // Pool unreachable, let connectToPool handle the error
      return;
    }
    await sleep(pollIntervalMs);
  }
  // Timeout — proceed anyway and let connectToPool deal with it
  log('⚠️', `${C.yellow}Waited ${maxWaitMs / 1000}s for pool slot, proceeding anyway${C.reset}`);
}
