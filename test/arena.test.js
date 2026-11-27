'use strict';

/**
 * migrate-arena tests (node:test, zero dependencies).
 *
 * Fixture binaries live in test/fixtures/ and are tiny node scripts invoked
 * as `node <fixture>` so the suite works on any platform with Node 18+.
 */

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ArenaError,
  formatDiff,
  loadCases,
  loadTape,
  recordTape,
  runTournament,
  rankResults,
  pickWinner,
  splitCommand,
  formatLeaderboard,
  formatDiffReport,
} = require('../src/index');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'arena.js');
const FIX = (name) => path.join(__dirname, 'fixtures', name);
const NODE = process.execPath;

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Run the CLI as a subprocess; resolves with {code, stdout, stderr} even on failure. */
function runCli(args, cwd) {
  return new Promise((resolve) => {
    execFile(NODE, [BIN, ...args], { cwd }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

const CAT_CASES = [
  { id: 'c1', argv: [], stdin: 'hello\n' },
  { id: 'c2', argv: [], stdin: 'HELLO\n' },
  { id: 'c3', argv: [], stdin: '' },
];

async function catTape(dir) {
  const tape = await recordTape({
    command: [NODE, FIX('cat.js')],
    cases: CAT_CASES,
    outFile: path.join(dir, 'cat-tape.json'),
  });
  return tape;
}

test('record + replay exact match: same binary passes every case', async (t) => {
  const dir = tmpDir(t);
  const tape = await catTape(dir);
  assert.equal(tape.results.length, 3);
  assert.equal(tape.results[0].stdout, 'hello\n');
  assert.equal(tape.results[0].code, 0);
  assert.equal(tape.results[2].stdout, '');
  const [result] = await runTournament(tape, [`${NODE} ${FIX('cat.js')}`], { jobs: 1 });
  assert.equal(result.pass, 3);
  assert.deepEqual(result.failing, []);
});

test('stdout mismatch detected: uppercasing fails the lowercase case only', async (t) => {
  const dir = tmpDir(t);
  const tape = await catTape(dir);
  const [result] = await runTournament(tape, [`${NODE} ${FIX('upper.js')}`], { jobs: 1 });
  assert.equal(result.pass, 2);
  assert.deepEqual(result.failing, ['c1']);
});

test('exit-code mismatch detected: failer passes nothing', async (t) => {
  const dir = tmpDir(t);
  const tape = await catTape(dir);
  const [result] = await runTournament(tape, [`${NODE} ${FIX('failer.js')}`], { jobs: 1 });
  assert.equal(result.pass, 0);
  assert.deepEqual(result.failing, ['c1', 'c2', 'c3']);
});

test('stdin handling: adder sums piped numbers, buggy variant fails the negative case', async (t) => {
  const dir = tmpDir(t);
  const cases = [
    { id: 'a', argv: [], stdin: '2 3' },
    { id: 'b', argv: [], stdin: '-2 3' },
    { id: 'c', argv: [], stdin: '10 20' },
  ];
  const tape = await recordTape({ command: [NODE, FIX('adder.js')], cases });
  assert.deepEqual(
    tape.results.map((r) => r.stdout),
    ['5\n', '1\n', '30\n'],
  );
  const [good, buggy] = await runTournament(
    tape,
    [`${NODE} ${FIX('adder.js')}`, `${NODE} ${FIX('adder-buggy.js')}`],
    { jobs: 2 },
  );
  assert.equal(good.pass, 3);
  assert.equal(buggy.pass, 2);
  assert.deepEqual(buggy.failing, ['b']);
});

test('timeout: a case that never finishes is a failure, not a hang', async (t) => {
  const dir = tmpDir(t);
  const tape = await recordTape({
    command: [NODE, FIX('hello.js')],
    cases: [{ id: 'h', argv: [], stdin: '' }],
  });
  const [result] = await runTournament(tape, [`${NODE} ${FIX('sleeper.js')}`], {
    jobs: 1,
    timeout: 200,
  });
  assert.equal(result.pass, 0);
  assert.equal(result.results[0].timedOut, true);
});

test('parallel run of 3 candidates ranks cat > upper > failer', async (t) => {
  const dir = tmpDir(t);
  const tape = await catTape(dir);
  const candidates = [
    `${NODE} ${FIX('failer.js')}`,
    `${NODE} ${FIX('upper.js')}`,
    `${NODE} ${FIX('cat.js')}`,
  ];
  const ranked = rankResults(await runTournament(tape, candidates, { jobs: 3 }));
  assert.deepEqual(
    ranked.map((r) => [r.candidate, r.pass]),
    [
      [`${NODE} ${FIX('cat.js')}`, 3],
      [`${NODE} ${FIX('upper.js')}`, 2],
      [`${NODE} ${FIX('failer.js')}`, 0],
    ],
  );
  assert.equal(pickWinner(ranked).candidate, `${NODE} ${FIX('cat.js')}`);
  // Same ranking with jobs=1 (deterministic regardless of parallelism).
  const rankedSerial = rankResults(await runTournament(tape, candidates, { jobs: 1 }));
  assert.deepEqual(
    rankedSerial.map((r) => r.candidate),
    ranked.map((r) => r.candidate),
  );
});

test('rank tie-break: equal pass rate, fewer failures first, then name', () => {
  const ranked = rankResults([
    { candidate: 'b-bin', pass: 1, total: 2, failing: ['x'] },
    { candidate: 'a-bin', pass: 1, total: 2, failing: ['x'] },
    { candidate: 'c-bin', pass: 2, total: 2, failing: [] },
  ]);
  assert.deepEqual(
    ranked.map((r) => r.candidate),
    ['c-bin', 'a-bin', 'b-bin'],
  );
  assert.deepEqual(
    ranked.map((r) => r.rank),
    [1, 2, 3],
  );
});

test('threshold exit codes via the CLI: rank gates on the winner', async (t) => {
  const dir = tmpDir(t);
  const tapeFile = path.join(dir, 'cat-tape.json');
  await catTape(dir); // writes cat-tape.json
  const base = ['rank', '--tape', tapeFile, '--candidates', `${NODE} ${FIX('upper.js')}`];
  const below = await runCli([...base, '--threshold', '100'], dir);
  assert.equal(below.code, 1, `expected exit 1, got ${below.code}: ${below.stdout} ${below.stderr}`);
  assert.match(below.stdout, /Winner:/);
  const above = await runCli([...base, '--threshold', '50'], dir);
  assert.equal(above.code, 0, `expected exit 0, got ${above.code}: ${above.stdout} ${above.stderr}`);
  const perfect = await runCli(
    ['rank', '--tape', tapeFile, '--candidates', `${NODE} ${FIX('cat.js')}`],
    dir,
  );
  assert.equal(perfect.code, 0);
  assert.match(perfect.stdout, /3\/3/);
});

test('diff output contains expected and actual lines', async (t) => {
  const dir = tmpDir(t);
  const tape = await catTape(dir);
  const [result] = await runTournament(tape, [`${NODE} ${FIX('upper.js')}`], { jobs: 1 });
  const report = formatDiffReport(tape, result, 'c1');
  assert.match(report, /-hello/);
  assert.match(report, /\+HELLO/);
  assert.match(report, /--- expected \(stdout\)/);
  assert.match(report, /\+\+\+ actual \(stdout\)/);
  // Identical streams produce "(no difference)".
  assert.match(formatDiff('stdout', 'same\n', 'same\n'), /no difference/);
});

test('record ad-hoc without a cases file: one case, exact output', async (t) => {
  const dir = tmpDir(t);
  const out = path.join(dir, 'hello-tape.json');
  const res = await runCli(
    ['record', '--out', out, '--', NODE, FIX('hello.js')],
    dir,
  );
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /recorded 1 case/);
  const tape = loadTape(out);
  assert.equal(tape.cases.length, 1);
  assert.equal(tape.cases[0].id, 'case-1');
  assert.equal(tape.results[0].stdout, 'hello\n');
  assert.equal(tape.results[0].code, 0);
});

test('record with a cases file writes a loadable tape', async (t) => {
  const dir = tmpDir(t);
  const casesFile = path.join(dir, 'cases.json');
  fs.writeFileSync(casesFile, JSON.stringify(CAT_CASES), 'utf8');
  const out = path.join(dir, 'tape.json');
  const res = await runCli(
    ['record', '--out', out, '--cases', casesFile, '--', NODE, FIX('cat.js')],
    dir,
  );
  assert.equal(res.code, 0, res.stderr);
  const tape = loadTape(out);
  assert.deepEqual(
    tape.cases.map((c) => c.id),
    ['c1', 'c2', 'c3'],
  );
  assert.deepEqual(loadCases(casesFile), CAT_CASES);
});

test('run prints per-candidate live lines and a summary', async (t) => {
  const dir = tmpDir(t);
  const tapeFile = path.join(dir, 'cat-tape.json');
  await catTape(dir);
  const res = await runCli(
    ['run', '--tape', tapeFile, '--candidates', `${NODE} ${FIX('cat.js')}`, `${NODE} ${FIX('upper.js')}`, '--jobs', '2'],
    dir,
  );
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /3\/3 passed/);
  assert.match(res.stdout, /2\/3 passed/);
  assert.match(res.stdout, /3 cases x 2 candidates/);
});

test('leaderboard format: header, separator, rows, winner line', () => {
  const ranked = rankResults([
    { candidate: 'good', pass: 3, total: 3, failing: [] },
    { candidate: 'buggy', pass: 1, total: 3, failing: ['c1', 'c3'] },
  ]);
  const table = formatLeaderboard(ranked);
  assert.match(table, /Rank\s+Candidate\s+Pass\s+%\s+Failing cases/);
  assert.match(table, /good\s+3\/3\s+100%/);
  assert.match(table, /buggy\s+1\/3\s+33%\s+c1, c3/);
  assert.equal(pickWinner(ranked).candidate, 'good');
});

test('validation errors: duplicate case ids, bad tape version, missing files', async (t) => {
  const dir = tmpDir(t);
  assert.throws(
    () => loadCases(path.join(dir, 'nope.json')),
    (e) => e instanceof ArenaError && /no such file/.test(e.message),
  );
  const dupFile = path.join(dir, 'dup.json');
  fs.writeFileSync(
    dupFile,
    JSON.stringify([
      { id: 'x', argv: [], stdin: '' },
      { id: 'x', argv: [], stdin: '' },
    ]),
    'utf8',
  );
  assert.throws(() => loadCases(dupFile), /duplicate case id "x"/);
  const badTape = path.join(dir, 'bad.json');
  fs.writeFileSync(badTape, JSON.stringify({ version: 99, command: ['x'], cases: [], results: [] }), 'utf8');
  assert.throws(() => loadTape(badTape), /unsupported version 99/);
  await assert.rejects(
    recordTape({ command: [NODE, FIX('sleeper.js')], cases: [{ id: 's', argv: [], stdin: '' }], timeout: 100 }),
    /timed out on case "s"/,
  );
});

test('CLI usage errors exit 2: unknown command, missing flags, bad values', async (t) => {
  const dir = tmpDir(t);
  const unknown = await runCli(['frobnicate'], dir);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown command/);
  const noTape = await runCli(['run', '--candidates', 'x'], dir);
  assert.equal(noTape.code, 2);
  assert.match(noTape.stderr, /missing required flag --tape/);
  const noCandidates = await runCli(['rank', '--tape', 't.json'], dir);
  assert.equal(noCandidates.code, 2);
  assert.match(noCandidates.stderr, /--candidates/);
  const badJobs = await runCli(['run', '--tape', 't.json', '--candidates', 'x', '--jobs', '0'], dir);
  assert.equal(badJobs.code, 2);
  assert.match(badJobs.stderr, /--jobs must be an integer/);
  const badFlag = await runCli(['run', '--bogus', '1'], dir);
  assert.equal(badFlag.code, 2);
  assert.match(badFlag.stderr, /unknown flag --bogus/);
});

test('help and version work', async (t) => {
  const dir = tmpDir(t);
  const help = await runCli(['--help'], dir);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /arena record/);
  assert.match(help.stdout, /arena rank/);
  const version = await runCli(['--version'], dir);
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('candidate command splitting handles quotes', () => {
  assert.deepEqual(splitCommand('node examples/candidate-good.js'), ['node', 'examples/candidate-good.js']);
  assert.deepEqual(splitCommand('/usr/local/bin/tool'), ['/usr/local/bin/tool']);
  assert.deepEqual(splitCommand('node "my dir/x.js" --flag'), ['node', 'my dir/x.js', '--flag']);
  assert.deepEqual(splitCommand("node 'a b.js'"), ['node', 'a b.js']);
  assert.throws(() => splitCommand('node "unterminated'), /unterminated quote/);
});

test('resolveCommandPaths absolutizes relative file tokens, leaves the rest alone', () => {
  const { resolveCommandPaths } = require('../src/runner');
  assert.deepEqual(resolveCommandPaths(['node', 'test/fixtures/cat.js', '--fast'], ROOT), [
    'node',
    path.join(ROOT, 'test/fixtures/cat.js'),
    '--fast',
  ]);
  assert.deepEqual(resolveCommandPaths(['node', 'no-such-file.js'], ROOT), ['node', 'no-such-file.js']);
  assert.deepEqual(resolveCommandPaths(['node'], ROOT), ['node']);
});

test('CLI rank with relative candidate paths (repo-root demo scenario)', async (t) => {
  const dir = tmpDir(t);
  const tapeFile = path.join(dir, 'grade-tape.json');
  const rec = await runCli(
    ['record', '--out', tapeFile, '--cases', 'examples/cases.json', '--', 'node', 'examples/original.js'],
    ROOT,
  );
  assert.equal(rec.code, 0, rec.stderr);
  const res = await runCli(
    ['rank', '--tape', tapeFile, '--candidates', 'node examples/candidate-good.js', 'node examples/candidate-buggy.js'],
    ROOT,
  );
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /Winner: node examples\/candidate-good\.js/);
  assert.match(res.stdout, /7\/7/);
  assert.match(res.stdout, /5\/7/);
});

test('direct executable candidate (no node prefix) works', async (t) => {
  const dir = tmpDir(t);
  const tape = await catTape(dir);
  const [result] = await runTournament(tape, [FIX('cat.js')], { jobs: 1 });
  assert.equal(result.pass, 3);
});

test('no leftover temp dirs after a tournament', async (t) => {
  const dir = tmpDir(t);
  const before = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('arena-'));
  const tape = await catTape(dir);
  await runTournament(tape, [`${NODE} ${FIX('cat.js')}`, `${NODE} ${FIX('upper.js')}`], { jobs: 2 });
  const after = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('arena-'));
  assert.deepEqual(after, before);
});
