#!/usr/bin/env node
// Fixture: copy stdin to stdout, exit 0.
'use strict';
process.stdin.pipe(process.stdout);
