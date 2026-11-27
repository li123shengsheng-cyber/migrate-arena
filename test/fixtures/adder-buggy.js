#!/usr/bin/env node
// Fixture: like adder.js, but takes the absolute value of negative
// operands — a subtle bug that only some cases catch.
'use strict';
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => {
  const nums = data.trim().split(/\s+/).filter(Boolean).map((s) => Math.abs(Number(s)));
  process.stdout.write(`${nums.reduce((a, b) => a + b, 0)}\n`);
});
