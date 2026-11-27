'use strict';

/**
 * A tiny promise pool: run async tasks with at most `jobs` in flight.
 * Results keep input order.
 */

async function runPool(tasks, jobs, worker) {
  const results = new Array(tasks.length);
  let next = 0;
  const n = Math.max(1, jobs | 0);
  const runners = Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next;
      next += 1;
      results[i] = await worker(tasks[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

module.exports = { runPool };
