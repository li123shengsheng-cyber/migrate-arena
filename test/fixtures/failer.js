#!/usr/bin/env node
// Fixture: always fail — "boom" on stderr, exit 1.
'use strict';
process.stdin.resume();
process.stdin.on('end', () => {
  process.stderr.write('boom\n');
  process.exit(1);
});
