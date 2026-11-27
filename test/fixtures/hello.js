#!/usr/bin/env node
// Fixture: always print "hello", exit 0. Used for ad-hoc record tests.
'use strict';
process.stdin.resume();
process.stdin.on('end', () => { process.stdout.write('hello\n'); });
