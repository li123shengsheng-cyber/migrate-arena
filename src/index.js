'use strict';

/**
 * migrate-arena library entry point.
 *
 *   recordTape({ command, cases, timeout, outFile })  — record a behavior tape
 *   runTournament(tape, candidates, { jobs, timeout }) — replay in parallel
 *   rankResults(results) / pickWinner(ranked)          — leaderboard + winner
 *   formatLeaderboard(ranked) / formatDiffReport(...)  — human-readable output
 */

const { ArenaError, loadCases, loadTape, saveTape } = require('./tape');
const { runOne, resolveCommandPaths } = require('./runner');
const tournament = require('./tournament');
const { formatDiff } = require('./diff');

/**
 * Record a tape: run the original command once per case and capture
 * stdout/stderr/exit code. The original must behave (no timeout, no spawn
 * error) — a tape cannot record "did not run" as expected behavior.
 */
async function recordTape({ command, cases, timeout = 5000, outFile = null }) {
  if (!Array.isArray(command) || command.length === 0) {
    throw new ArenaError('record needs a command after -- (e.g. arena record --out tape.json -- ./original)');
  }
  // Resolve relative file paths now: replay runs in a temp dir later, and
  // the tape must stay valid from anywhere.
  const resolvedCommand = resolveCommandPaths(command);
  const results = [];
  for (const c of cases) {
    const r = await runOne(resolvedCommand, c, { timeout });
    if (r.timedOut) {
      throw new ArenaError(
        `original timed out on case "${c.id}" (>${timeout}ms) — pass a larger --timeout`,
      );
    }
    if (r.error) {
      throw new ArenaError(`failed to run original on case "${c.id}": ${r.error}`);
    }
    results.push({ id: r.id, stdout: r.stdout, stderr: r.stderr, code: r.code });
  }
  const tape = {
    version: 1,
    command,
    createdAt: new Date().toISOString(),
    cases,
    results,
  };
  if (outFile) saveTape(outFile, tape);
  return tape;
}

module.exports = {
  ArenaError,
  formatDiff,
  loadCases,
  loadTape,
  recordTape,
  runOne,
  saveTape,
  ...tournament,
};
