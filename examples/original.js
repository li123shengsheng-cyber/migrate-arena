#!/usr/bin/env node
/**
 * grade — the ORIGINAL program.
 *
 * Reads "name,score" lines on stdin and grades each one against
 * --threshold (default 60):
 *   score >= threshold  -> "name: PASS"
 *   score <  threshold  -> "name: FAIL"
 *   not a number        -> "name: INVALID"
 * Blank lines are ignored. At the end it prints "passed P of T".
 * An unknown option exits 2 with an error on stderr.
 */

'use strict';

const fs = require('fs');

function main() {
  const args = process.argv.slice(2);
  let threshold = 60;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--threshold') {
      const v = Number(args[i + 1]);
      if (!Number.isFinite(v)) {
        process.stderr.write('error: --threshold needs a number\n');
        process.exit(2);
      }
      threshold = v;
      i += 1;
    } else {
      process.stderr.write(`error: unknown option ${args[i]}\n`);
      process.exit(2);
    }
  }

  const text = fs.readFileSync(0, 'utf8');
  let total = 0;
  let passed = 0;
  for (const line of text.split('\n')) {
    if (line === '') continue;
    total += 1;
    const comma = line.indexOf(',');
    const name = comma === -1 ? line : line.slice(0, comma);
    const score = comma === -1 ? NaN : Number(line.slice(comma + 1));
    if (!Number.isFinite(score)) {
      process.stdout.write(`${name}: INVALID\n`);
    } else if (score >= threshold) {
      passed += 1;
      process.stdout.write(`${name}: PASS\n`);
    } else {
      process.stdout.write(`${name}: FAIL\n`);
    }
  }
  process.stdout.write(`passed ${passed} of ${total}\n`);
}

main();
