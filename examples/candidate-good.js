#!/usr/bin/env node
/**
 * grade — candidate rewrite #1 ("good").
 *
 * A genuine rewrite: stdin is consumed as a stream instead of one
 * readFileSync, the grading lives in a `verdict()` helper, and the summary
 * is accumulated separately. Behavior is byte-identical to original.js —
 * same stdout, same stderr, same exit codes on every case.
 */

'use strict';

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseThreshold(argv) {
  let threshold = 60;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== '--threshold') die(`error: unknown option ${a}`);
    const n = Number(argv[i + 1]);
    if (!Number.isFinite(n)) die('error: --threshold needs a number');
    threshold = n;
    i += 1;
  }
  return threshold;
}

function verdict(line, threshold) {
  const comma = line.indexOf(',');
  const name = comma === -1 ? line : line.slice(0, comma);
  const score = comma === -1 ? NaN : Number(line.slice(comma + 1));
  if (!Number.isFinite(score)) return { line: `${name}: INVALID`, passed: false };
  if (score >= threshold) return { line: `${name}: PASS`, passed: true };
  return { line: `${name}: FAIL`, passed: false };
}

function main() {
  const threshold = parseThreshold(process.argv.slice(2));
  let buffer = '';
  let total = 0;
  let passed = 0;
  const out = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
  });
  process.stdin.on('end', () => {
    for (const line of buffer.split('\n')) {
      if (line === '') continue;
      total += 1;
      const v = verdict(line, threshold);
      if (v.passed) passed += 1;
      out.push(v.line);
    }
    out.push(`passed ${passed} of ${total}`);
    process.stdout.write(`${out.join('\n')}\n`);
  });
}

main();
