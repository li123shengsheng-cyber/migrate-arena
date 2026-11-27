#!/usr/bin/env node
/**
 * arena — behavior tournaments for program rewrites.
 *
 *   arena record --out tape.json --cases cases.json -- <original> [args...]
 *   arena record --out tape.json -- <command...>          (single ad-hoc case)
 *   arena run   --tape tape.json --candidates <bin...> [--jobs N] [--timeout MS]
 *   arena rank  --tape tape.json --candidates <bin...> [--threshold PCT]
 *   arena diff  --tape tape.json --candidate <bin> [--case <id>]
 *   arena --help | --version
 *
 * Exit codes: 0 = done (rank winner meets the threshold),
 *               1 = rank winner below --threshold (default 100),
 *               2 = usage error (bad flags, missing/unreadable files).
 *
 * `arena run` always exits 0 once the replay finished — failures are data,
 * not errors. Use `arena rank` as the CI gate.
 */

'use strict';

const os = require('os');
const {
  ArenaError,
  loadCases,
  loadTape,
  recordTape,
  runTournament,
  rankResults,
  pickWinner,
  pct,
  formatLeaderboard,
  formatDiffReport,
} = require('../src/index');

const VERSION = require('../package.json').version;

const USAGE = `arena — behavior tournaments for program rewrites

Usage:
  arena record --out tape.json --cases cases.json -- <original> [args...]
  arena record --out tape.json -- <command...>            single ad-hoc case
  arena run  --tape tape.json --candidates <bin...> [--jobs N] [--timeout MS]
  arena rank --tape tape.json --candidates <bin...> [--threshold PCT] [--jobs N] [--timeout MS]
  arena diff --tape tape.json --candidate <bin> [--case <id>]
  arena --help | --version

Each candidate is one shell-quoted string, e.g. "node rewrite.js" or
"/usr/local/bin/tool --fast". Candidates run in parallel (default jobs =
CPU count), each in its own fresh temp dir, with a per-case timeout
(default 5000ms).

Exit codes: 0 done (rank winner meets --threshold, default 100),
            1 rank winner below threshold, 2 usage error.`;

const VALUE_FLAGS = new Set(['out', 'cases', 'tape', 'candidate', 'jobs', 'timeout', 'threshold', 'case']);
const BOOL_FLAGS = new Set(['help', 'version']);

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let rest = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (rest !== null) {
      rest.push(arg);
      continue;
    }
    if (arg === '--') {
      rest = [];
      continue;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const inline = eq === -1 ? null : arg.slice(eq + 1);
      if (BOOL_FLAGS.has(name)) {
        flags[name] = true;
        continue;
      }
      if (name === 'candidates') {
        const values = inline !== null ? [inline] : [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith('--') && argv[i + 1] !== '--') {
          values.push(argv[i + 1]);
          i += 1;
        }
        flags.candidates = (flags.candidates || []).concat(values);
        continue;
      }
      if (VALUE_FLAGS.has(name)) {
        if (inline !== null) {
          flags[name] = inline;
        } else if (i + 1 < argv.length) {
          flags[name] = argv[i + 1];
          i += 1;
        } else {
          throw new ArenaError(`--${name} needs a value`);
        }
        continue;
      }
      throw new ArenaError(`unknown flag --${name}`);
    }
    if (arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '-V') {
      flags.version = true;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      throw new ArenaError(`unknown flag ${arg}`);
    }
    positionals.push(arg);
  }
  return { flags, positionals, rest: rest || [] };
}

function need(flags, name) {
  if (flags[name] === undefined || flags[name] === '') {
    throw new ArenaError(`missing required flag --${name}`);
  }
  return flags[name];
}

function needInt(flags, name, def, { min = 1, max = Infinity } = {}) {
  if (flags[name] === undefined) return def;
  const n = Number(flags[name]);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ArenaError(`--${name} must be an integer between ${min} and ${max}, got "${flags[name]}"`);
  }
  return n;
}

function needCandidates(flags) {
  const list = flags.candidates || [];
  if (list.length === 0) {
    throw new ArenaError('missing required flag --candidates (at least one candidate binary)');
  }
  return list;
}

function checkNoRest(rest) {
  if (rest.length > 0) {
    throw new ArenaError(`unexpected arguments after --: ${rest.join(' ')}`);
  }
}

async function cmdRecord(flags, rest) {
  const out = need(flags, 'out');
  if (rest.length === 0) {
    throw new ArenaError('record needs a command after -- (e.g. arena record --out tape.json -- ./original)');
  }
  const cases = flags.cases ? loadCases(flags.cases) : [{ id: 'case-1', argv: [], stdin: '' }];
  const timeout = needInt(flags, 'timeout', 5000);
  const tape = await recordTape({ command: rest, cases, timeout, outFile: out });
  console.log(`recorded ${tape.cases.length} case${tape.cases.length === 1 ? '' : 's'} from ${rest.join(' ')} -> ${out}`);
  return 0;
}

async function cmdRun(flags, rest, { rank = false } = {}) {
  checkNoRest(rest);
  const tapeFile = need(flags, 'tape');
  const candidates = needCandidates(flags);
  const jobs = needInt(flags, 'jobs', os.cpus().length);
  const timeout = needInt(flags, 'timeout', 5000);
  const threshold = needInt(flags, 'threshold', 100, { min: 0, max: 100 });
  const tape = loadTape(tapeFile);

  const results = await runTournament(tape, candidates, {
    jobs,
    timeout,
    onCandidateDone: (r) => {
      if (!rank) console.log(`${r.candidate}: ${r.pass}/${r.total} passed`);
    },
  });

  if (!rank) {
    console.log(`${tape.cases.length} cases x ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`);
    return 0;
  }

  const ranked = rankResults(results);
  console.log(formatLeaderboard(ranked));
  const winner = pickWinner(ranked);
  const wpct = pct(winner.pass, winner.total);
  console.log(`\nWinner: ${winner.candidate} (${winner.pass}/${winner.total}, ${wpct}%)`);
  if (wpct < threshold) {
    console.log(`winner is below the ${threshold}% threshold`);
    return 1;
  }
  return 0;
}

async function cmdDiff(flags, rest) {
  checkNoRest(rest);
  const tapeFile = need(flags, 'tape');
  const candidate = need(flags, 'candidate');
  const tape = loadTape(tapeFile);
  const timeout = needInt(flags, 'timeout', 5000);
  const [result] = await runTournament(tape, [candidate], { jobs: 1, timeout });
  console.log(formatDiffReport(tape, result, flags.case));
  return 0;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`arena: ${err.message}`);
    return 2;
  }
  const { flags, positionals, rest } = parsed;
  if (flags.version) {
    console.log(VERSION);
    return 0;
  }
  const command = positionals[0];
  if (flags.help || command === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (!command) {
    console.error(USAGE);
    return 2;
  }
  if (positionals.length > 1) {
    console.error(`arena: unexpected argument "${positionals[1]}"`);
    return 2;
  }
  try {
    switch (command) {
      case 'record':
        return await cmdRecord(flags, rest);
      case 'run':
        return await cmdRun(flags, rest);
      case 'rank':
        return await cmdRun(flags, rest, { rank: true });
      case 'diff':
        return await cmdDiff(flags, rest);
      default:
        throw new ArenaError(`unknown command "${command}"\n${USAGE}`);
    }
  } catch (err) {
    if (err instanceof ArenaError) {
      console.error(`arena: ${err.message}`);
      return 2;
    }
    console.error(`arena: ${err.message}`);
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
