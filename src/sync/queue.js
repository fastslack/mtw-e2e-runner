/**
 * Sync Queue Manager
 * 
 * Manages the offline sync queue for when the hub is unreachable.
 * Features:
 * - Persistent queue in SQLite
 * - Exponential backoff retry
 * - Priority-based processing
 * - Queue statistics and monitoring
 */

import { 
  enqueueSync, 
  getQueuedItems, 
  completeQueueItem, 
  failQueueItem,
  cleanupQueue,
  getQueueStats,
} from './schema.js';

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE MANAGER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class QueueManager {
  constructor(options = {}) {
    this.retryInterval = options.retryInterval || 60000; // 1 minute
    this.maxBatchSize = options.maxBatchSize || 10;
    this.cleanupDays = options.cleanupDays || 7;
    this.processor = options.processor || null;
    
    this.isProcessing = false;
    this.intervalId = null;
  }
  
  /**
   * Start the queue processor.
   */
  start() {
    if (this.intervalId) return;
    
    this.intervalId = setInterval(() => {
      this.process().catch(err => {
        console.error('[queue] Processing error:', err.message);
      });
    }, this.retryInterval);
    
    // Process immediately
    this.process().catch(() => {});
    
    // Cleanup old items periodically (once per hour)
    setInterval(() => {
      this.cleanup();
    }, 3600000);
  }
  
  /**
   * Stop the queue processor.
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  /**
   * Add an item to the queue.
   */
  enqueue(operation, resourceType, resourceId, payload, priority = 0) {
    return enqueueSync({
      operation,
      resourceType,
      resourceId,
      payload,
      priority,
    });
  }
  
  /**
   * Process pending queue items.
   */
  async process() {
    if (this.isProcessing || !this.processor) return;
    
    this.isProcessing = true;
    let processed = 0;
    let failed = 0;
    
    try {
      const items = getQueuedItems(this.maxBatchSize);
      
      for (const item of items) {
        try {
          const payload = JSON.parse(item.payload);
          await this.processor(item.operation, payload, item);
          completeQueueItem(item.id);
          processed++;
        } catch (err) {
          failQueueItem(item.id, err.message);
          failed++;
        }
      }
      
      if (processed > 0 || failed > 0) {
        console.log(`[queue] Processed: ${processed} succeeded, ${failed} failed`);
      }
    } finally {
      this.isProcessing = false;
    }
    
    return { processed, failed };
  }
  
  /**
   * Clean up old completed/failed items.
   */
  cleanup() {
    const removed = cleanupQueue(this.cleanupDays);
    if (removed > 0) {
      console.log(`[queue] Cleaned up ${removed} old items`);
    }
    return removed;
  }
  
  /**
   * Get queue statistics.
   */
  getStats() {
    const rows = getQueueStats();
    const stats = {
      pending: 0,
      completed: 0,
      failed: 0,
      total: 0,
    };
    
    for (const row of rows) {
      stats[row.status] = row.count;
      stats.total += row.count;
    }
    
    return stats;
  }
  
  /**
   * Get pending items count.
   */
  getPendingCount() {
    const stats = this.getStats();
    return stats.pending;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

let queueManager = null;

/**
 * Get or create the queue manager singleton.
 */
export function getQueueManager(options = {}) {
  if (!queueManager) {
    queueManager = new QueueManager(options);
  }
  return queueManager;
}

/**
 * Reset the queue manager (for testing).
 */
export function resetQueueManager() {
  if (queueManager) {
    queueManager.stop();
    queueManager = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Queue a run for sync.
 */
export function queueRun(project, run, testResults, screenshots = []) {
  return enqueueSync({
    operation: 'push_run',
    resourceType: 'run',
    resourceId: run.runId,
    payload: { project, run, testResults, screenshots },
    priority: 0,
  });
}

/**
 * Queue a screenshot for upload.
 */
export function queueScreenshot(hash, filePath) {
  return enqueueSync({
    operation: 'push_screenshot',
    resourceType: 'screenshot',
    resourceId: hash,
    payload: { hash, filePath },
    priority: -1, // Lower priority than runs
  });
}
