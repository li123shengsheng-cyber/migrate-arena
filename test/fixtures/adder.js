#!/usr/bin/env node
// Fixture: read whitespace-separated numbers on stdin, print their sum.
'use strict';
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => {
  const nums = data.trim().split(/\s+/).filter(Boolean).map(Number);
  process.stdout.write(`${nums.reduce((a, b) => a + b, 0)}\n`);
});
