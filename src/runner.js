'use strict';

/**
 * Run one program once, black-box: feed stdin, capture stdout/stderr/exit
 * code, enforce a per-case timeout. The program is never inspected, only
 * observed — it can be written in any language.
 *
 * Returns { id, stdout, stderr, code, signal, timedOut, error }.
 * code is null when the process never exited normally (timeout / spawn error).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Candidates run in a fresh temp dir, so a relative file path in the
 * command would stop resolving there. Rewrite any token that names an
 * existing file (relative to `baseDir`, the arena's own cwd) to its
 * absolute path. Bare binary names ("node"), flags and data values are
 * left alone — they name no file in the cwd.
 */
function resolveCommandPaths(command, baseDir = process.cwd()) {
  return command.map((token) => {
    if (path.isAbsolute(token)) return token;
    const full = path.resolve(baseDir, token);
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch (_) {
      // not a file — leave the token alone
    }
    return token;
  });
}

function runOne(command, caseDef, { timeout = 5000, cwd = undefined } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command[0], [...command.slice(1), ...caseDef.argv], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({
        id: caseDef.id,
        stdout: '',
        stderr: '',
        code: null,
        signal: null,
        timedOut: false,
        error: err.message,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch (_) {
        // already gone
      }
    }, timeout);

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      done({
        id: caseDef.id,
        stdout,
        stderr,
        code: null,
        signal: null,
        timedOut: false,
        error: err.message,
      });
    });
    child.on('close', (code, signal) => {
      done({ id: caseDef.id, stdout, stderr, code, signal, timedOut, error: null });
    });

    if (caseDef.stdin) child.stdin.write(caseDef.stdin);
    child.stdin.end();
  });
}

module.exports = { resolveCommandPaths, runOne };
