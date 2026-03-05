/**
 * Sync Module - Multi-Instance Synchronization
 * 
 * This module enables e2e-runner instances to sync test results across machines.
 * 
 * Modes:
 * - standalone: No sync (default)
 * - hub: Accept connections from agents, aggregate results
 * - agent: Connect to a hub, push results, pull from other instances
 * 
 * Usage:
 *   import { initSync, pushRun, pullRuns } from './sync/index.js';
 *   await initSync(config);
 */

export * from './auth.js';
export * from './schema.js';
export * from './middleware.js';
export * from './client.js';
export * from './queue.js';

// Re-export commonly used functions with cleaner names
export { 
  generateApiKey,
  generateTotpSecret,
  generateTotpUri,
  generateMasterKey,
  hashApiKey,
  signJwt,
  verifyJwt,
} from './auth.js';

export {
  migrateSyncSchema,
  createInstance,
  getInstance,
  listInstances,
  updateInstanceStatus,
  getHubConnection,
  saveHubConnection,
  enqueueSync,
  getQueuedItems,
  logAudit,
  queryAuditLog,
} from './schema.js';

export {
  createAuthMiddleware,
  createRateLimitMiddleware,
  requirePermission,
  authenticateWithCredentials,
  getJwtSecret,
  getMasterKey,
} from './middleware.js';

export {
  SyncClient,
  getSyncClient,
  pushRun,
  pullRuns,
} from './client.js';

export {
  QueueManager,
  getQueueManager,
  queueRun,
  queueScreenshot,
} from './queue.js';
