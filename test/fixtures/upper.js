#!/usr/bin/env node
// Fixture: copy stdin to stdout uppercased, exit 0.
'use strict';
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => { process.stdout.write(data.toUpperCase()); });
