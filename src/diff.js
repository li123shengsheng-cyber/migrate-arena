'use strict';

/**
 * Small dependency-free unified-style line diff.
 *
 * lineDiff() computes an LCS-based line diff and groups changes into hunks
 * with `context` lines of context, like `diff -u`. Outputs are capped at
 * 500 lines per side so a runaway program cannot blow up the report.
 */

const MAX_LINES = 500;

function splitLines(text) {
  if (text === '') return [];
  const lines = text.split('\n');
  // A trailing newline is a terminator, not an extra empty line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Returns { hunks, truncated } where each hunk is
 * { aStart, aCount, bStart, bCount, lines: [{type: ' '|'-'|'+', text}] }.
 * aStart/bStart are 1-based.
 */
function lineDiff(aText, bText, context = 3) {
  const aFull = splitLines(aText);
  const bFull = splitLines(bText);
  const truncated = aFull.length > MAX_LINES || bFull.length > MAX_LINES;
  const a = aFull.slice(0, MAX_LINES);
  const b = bFull.slice(0, MAX_LINES);
  const n = a.length;
  const m = b.length;

  // LCS lengths table.
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: '-', text: a[i] });
      i += 1;
    } else {
      ops.push({ type: '+', text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: '-', text: a[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: '+', text: b[j] });
    j += 1;
  }

  // Group into hunks: changes separated by more than 2*context unchanged
  // lines start a new hunk; each hunk keeps `context` lines around changes.
  const hunks = [];
  let k = 0;
  while (k < ops.length) {
    while (k < ops.length && ops[k].type === ' ') k += 1;
    if (k >= ops.length) break;
    const start = Math.max(0, k - context);
    let end = k;
    while (end < ops.length) {
      if (ops[end].type !== ' ') {
        end += 1;
        continue;
      }
      let run = 0;
      while (end + run < ops.length && ops[end + run].type === ' ') run += 1;
      if (end + run >= ops.length) {
        end += Math.min(run, context);
        break;
      }
      if (run > 2 * context) {
        end += context;
        break;
      }
      end += run; // short gap: same hunk
    }
    const slice = ops.slice(start, end);
    let aCount = 0;
    let bCount = 0;
    let aStart = 0;
    let bStart = 0;
    for (let t = 0; t < start; t++) {
      if (ops[t].type !== '+') aStart += 1;
      if (ops[t].type !== '-') bStart += 1;
    }
    for (const op of slice) {
      if (op.type !== '+') aCount += 1;
      if (op.type !== '-') bCount += 1;
    }
    hunks.push({ aStart: aStart + 1, aCount, bStart: bStart + 1, bCount, lines: slice });
    k = end;
  }
  return { hunks, truncated };
}

function formatDiff(label, expected, actual) {
  const { hunks, truncated } = lineDiff(expected, actual);
  const out = [`--- expected (${label})`, `+++ actual (${label})`];
  if (hunks.length === 0) {
    out.push('(no difference)');
    return out.join('\n');
  }
  for (const h of hunks) {
    out.push(`@@ -${h.aStart},${h.aCount} +${h.bStart},${h.bCount} @@`);
    for (const l of h.lines) out.push(`${l.type}${l.text}`);
  }
  if (truncated) out.push('(diff truncated: output longer than 500 lines)');
  return out.join('\n');
}

module.exports = { formatDiff, lineDiff, splitLines };
