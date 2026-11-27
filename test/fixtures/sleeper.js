#!/usr/bin/env node
// Fixture: sleep 10 seconds, then print "done". Used for timeout tests.
'use strict';
process.stdin.resume();
setTimeout(() => { process.stdout.write('done\n'); }, 10000);
