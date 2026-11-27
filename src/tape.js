'use strict';

/**
 * Tape and cases-file loading, validation and saving.
 *
 * Tape format (version 1):
 *   {
 *     "version": 1,
 *     "command": ["node", "original.js"],   // the original program, as invoked
 *     "createdAt": "2026-11-27T10:00:00.000Z",
 *     "cases":   [{ "id": "basic", "argv": [], "stdin": "a,1\n" }],
 *     "results": [{ "id": "basic", "stdout": "...", "stderr": "", "code": 0 }]
 *   }
 * results[i] is the recorded behavior of cases[i].
 */

const fs = require('fs');

const TAPE_VERSION = 1;

class ArenaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArenaError';
  }
}

function readJsonFile(file, what) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new ArenaError(
      `cannot read ${what} file ${file}: ${err.code === 'ENOENT' ? 'no such file' : err.message}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ArenaError(`${what} file ${file} is not valid JSON: ${err.message}`);
  }
}

function validateCases(cases, source) {
  if (!Array.isArray(cases)) {
    throw new ArenaError(`${source}: cases must be a JSON array of {id, argv, stdin}`);
  }
  const seen = new Set();
  return cases.map((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw new ArenaError(`${source}: case #${i} must be an object {id, argv, stdin}`);
    }
    if (typeof c.id !== 'string' || c.id.length === 0) {
      throw new ArenaError(`${source}: case #${i} is missing a non-empty string "id"`);
    }
    if (seen.has(c.id)) {
      throw new ArenaError(`${source}: duplicate case id "${c.id}"`);
    }
    seen.add(c.id);
    const argv = c.argv === undefined ? [] : c.argv;
    const stdin = c.stdin === undefined ? '' : c.stdin;
    if (!Array.isArray(argv) || !argv.every((a) => typeof a === 'string')) {
      throw new ArenaError(`${source}: case "${c.id}" argv must be an array of strings`);
    }
    if (typeof stdin !== 'string') {
      throw new ArenaError(`${source}: case "${c.id}" stdin must be a string`);
    }
    return { id: c.id, argv, stdin };
  });
}

function loadCases(file) {
  return validateCases(readJsonFile(file, 'cases'), file);
}

function loadTape(file) {
  const tape = readJsonFile(file, 'tape');
  if (!tape || typeof tape !== 'object' || Array.isArray(tape)) {
    throw new ArenaError(`tape file ${file} must be a JSON object`);
  }
  if (tape.version !== TAPE_VERSION) {
    throw new ArenaError(
      `tape file ${file}: unsupported version ${JSON.stringify(tape.version)} (expected ${TAPE_VERSION})`,
    );
  }
  if (
    !Array.isArray(tape.command) ||
    tape.command.length === 0 ||
    !tape.command.every((c) => typeof c === 'string')
  ) {
    throw new ArenaError(`tape file ${file}: "command" must be a non-empty array of strings`);
  }
  const cases = validateCases(tape.cases, `tape ${file}`);
  if (!Array.isArray(tape.results) || tape.results.length !== cases.length) {
    throw new ArenaError(`tape file ${file}: "results" must be an array with one entry per case`);
  }
  const byId = new Map();
  for (const r of tape.results) {
    if (!r || typeof r.id !== 'string') {
      throw new ArenaError(`tape file ${file}: every result needs a string "id"`);
    }
    byId.set(r.id, r);
  }
  for (const c of cases) {
    const r = byId.get(c.id);
    if (!r) {
      throw new ArenaError(`tape file ${file}: no result for case "${c.id}"`);
    }
    if (
      typeof r.stdout !== 'string' ||
      typeof r.stderr !== 'string' ||
      !(typeof r.code === 'number' || r.code === null)
    ) {
      throw new ArenaError(
        `tape file ${file}: result for case "${c.id}" needs stdout/stderr strings and a numeric code (or null)`,
      );
    }
  }
  return {
    version: tape.version,
    command: tape.command,
    createdAt: tape.createdAt || null,
    cases,
    results: tape.results,
  };
}

function saveTape(file, tape) {
  fs.writeFileSync(file, `${JSON.stringify(tape, null, 2)}\n`, 'utf8');
}

module.exports = {
  ArenaError,
  TAPE_VERSION,
  loadCases,
  loadTape,
  readJsonFile,
  saveTape,
  validateCases,
};
