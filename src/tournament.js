'use strict';

/**
 * The tournament: replay a tape against every candidate, rank the results,
 * pick the winner, and render the leaderboard and failure diffs.
 *
 * Parallelism is across candidates — each candidate runs in its own fresh
 * temp dir, and up to `jobs` candidates run at once (default: CPU count).
 * Cases within one candidate run sequentially so a candidate's own file
 * effects never race with itself.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runOne, resolveCommandPaths } = require('./runner');
const { runPool } = require('./pool');
const { formatDiff } = require('./diff');

function compareResult(expected, actual) {
  if (!actual || actual.timedOut || actual.error) return false;
  return (
    actual.stdout === expected.stdout &&
    actual.stderr === expected.stderr &&
    actual.code === expected.code
  );
}

/**
 * Minimal shell-like split for a candidate command string:
 *   'node examples/candidate-good.js' -> ['node', 'examples/candidate-good.js']
 * Handles single/double quotes and backslash escapes. A bare path stays one token.
 */
function splitCommand(candidate) {
  const parts = [];
  let cur = '';
  let quote = null;
  let hasToken = false;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"' && i + 1 < candidate.length && '"\\$`'.includes(candidate[i + 1])) {
        cur += candidate[i + 1];
        i += 1;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (ch === '\\' && i + 1 < candidate.length) {
      cur += candidate[i + 1];
      i += 1;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken || cur !== '') {
        parts.push(cur);
        cur = '';
        hasToken = false;
      }
    } else {
      cur += ch;
      hasToken = true;
    }
  }
  if (quote) throw new Error(`unterminated quote in candidate command: ${candidate}`);
  if (hasToken || cur !== '') parts.push(cur);
  return parts;
}

async function runCandidate(tape, command, { timeout = 5000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-'));
  try {
    const expectedById = new Map(tape.results.map((r) => [r.id, r]));
    const results = [];
    for (const c of tape.cases) {
      const actual = await runOne(command, c, { timeout, cwd: dir });
      results.push({ ...actual, pass: compareResult(expectedById.get(c.id), actual) });
    }
    return results;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function runTournament(tape, candidates, { jobs = os.cpus().length, timeout = 5000, onCandidateDone } = {}) {
  // Candidates are invoked from a fresh temp dir, so resolve any relative
  // file paths in the command against the arena's own cwd first.
  const jobsList = candidates.map((candidate) => ({
    candidate,
    command: resolveCommandPaths(splitCommand(candidate)),
  }));
  return runPool(jobsList, jobs, async ({ candidate, command }) => {
    const caseResults = await runCandidate(tape, command, { timeout });
    const pass = caseResults.filter((r) => r.pass).length;
    const out = {
      candidate,
      command,
      results: caseResults,
      pass,
      total: tape.cases.length,
      failing: caseResults.filter((r) => !r.pass).map((r) => r.id),
    };
    if (onCandidateDone) onCandidateDone(out);
    return out;
  });
}

/**
 * Highest pass rate wins; ties break by fewest failing cases, then by name.
 */
function rankResults(results) {
  const ranked = [...results].sort((a, b) => {
    const pa = a.total ? a.pass / a.total : 0;
    const pb = b.total ? b.pass / b.total : 0;
    if (pb !== pa) return pb - pa;
    if (a.failing.length !== b.failing.length) return a.failing.length - b.failing.length;
    return a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0;
  });
  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}

function pickWinner(ranked) {
  return ranked.length > 0 ? ranked[0] : null;
}

function pct(pass, total) {
  return total ? Math.round((pass / total) * 100) : 0;
}

function formatLeaderboard(ranked) {
  const rows = ranked.map((r) => ({
    rank: String(r.rank),
    candidate: r.candidate,
    pass: `${r.pass}/${r.total}`,
    pct: `${pct(r.pass, r.total)}%`,
    failing: r.failing.length > 0 ? r.failing.join(', ') : '-',
  }));
  const headers = { rank: 'Rank', candidate: 'Candidate', pass: 'Pass', pct: '%', failing: 'Failing cases' };
  const widths = {};
  for (const key of Object.keys(headers)) {
    widths[key] = Math.max(headers[key].length, ...rows.map((r) => r[key].length));
  }
  const line = (r) => Object.keys(headers).map((k) => r[k].padEnd(widths[k])).join('  ');
  const out = [
    line(headers),
    Object.keys(headers).map((k) => '-'.repeat(widths[k])).join('  '),
  ];
  for (const r of rows) out.push(line(r));
  return out.join('\n');
}

function formatCaseDiff(tape, candidateResult, caseId) {
  const expected = tape.results.find((r) => r.id === caseId);
  const actual = candidateResult.results.find((r) => r.id === caseId);
  if (!expected || !actual) return `case "${caseId}" not found`;
  const out = [`== ${caseId} ==`];
  if (actual.timedOut) out.push('(timed out after the per-case timeout)');
  if (actual.error) out.push(`(failed to run: ${actual.error})`);
  if (actual.code !== expected.code) {
    out.push(
      `exit code: expected ${expected.code}, actual ${actual.code === null ? 'null (did not exit)' : actual.code}`,
    );
  }
  if (actual.stdout !== expected.stdout) out.push(formatDiff('stdout', expected.stdout, actual.stdout));
  if (actual.stderr !== expected.stderr) out.push(formatDiff('stderr', expected.stderr, actual.stderr));
  return out.join('\n');
}

function formatDiffReport(tape, candidateResult, caseId) {
  const ids = caseId ? [caseId] : candidateResult.failing;
  if (ids.length === 0) return `all cases pass for ${candidateResult.candidate}`;
  return ids.map((id) => formatCaseDiff(tape, candidateResult, id)).join('\n\n');
}

module.exports = {
  compareResult,
  formatCaseDiff,
  formatDiffReport,
  formatLeaderboard,
  pct,
  pickWinner,
  rankResults,
  runCandidate,
  runTournament,
  splitCommand,
};
