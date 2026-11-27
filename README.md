# migrate-arena

**Behavior is the judge, parallelism is the search.**

AI rewrites are cheap to generate and expensive to trust. Existing
record-and-replay checkers verify *one* rewrite at a time — but when an
agent produces five candidate rewrites, you need a tournament, not a
single match. `migrate-arena` records the original program's behavior
once, replays it against **N candidate binaries in parallel**, ranks
them by pass rate, and picks the verified winner.

It borrows three ideas from trending tools and combines them into
something none of them does: the record-and-replay verification of
[rust-anything](https://github.com/erkamyaman/rust-anything), the
parallel-agents idea of [orca](https://github.com/stablyai/orca), and
the black-box thinking of [rea](https://github.com/morluto/rea) — every
program is treated as a black box, judged only by what it does.

- Node.js 18+, **zero runtime dependencies**
- Black-box: candidates can be written in any language
- Parallel replay across candidates (default jobs = CPU count), each in
  its own fresh temp dir, with a per-case timeout
- Leaderboard + winner picking with a CI-friendly exit code
- `npm test` — 21 tests, all passing

## Install

Until the package is published to npm, install from the repo:

```bash
git clone https://github.com/li123shengsheng-cyber/migrate-arena.git
cd migrate-arena
npm install -g .
```

Or run it without installing: `node bin/arena.js <command>`.

## Quick start

The repo ships a demo: `grade`, a tiny CLI that grades `name,score`
lines against `--threshold`. Two candidate rewrites were produced —
one correct, one wrong by exactly one character (`>` instead of `>=`).

```bash
# 1. Record the original's behavior once (7 cases)
node bin/arena.js record --out /tmp/grade-tape.json --cases examples/cases.json -- node examples/original.js
# recorded 7 cases from node examples/original.js -> /tmp/grade-tape.json

# 2. Run the tournament
node bin/arena.js rank --tape /tmp/grade-tape.json \
  --candidates "node examples/candidate-good.js" "node examples/candidate-buggy.js"
```

Real output:

```
Rank  Candidate                         Pass  %     Failing cases
----  --------------------------------  ----  ----  -------------------
1     node examples/candidate-good.js   7/7   100%  -
2     node examples/candidate-buggy.js  5/7   71%   basic, threshold-70

Winner: node examples/candidate-good.js (7/7, 100%)
```

The buggy rewrite passes 5 of 7 — it only fails the boundary cases
(`carol,60` and `bob,70`, scores exactly on the threshold). See exactly
what went wrong with:

```bash
node bin/arena.js diff --tape /tmp/grade-tape.json --candidate "node examples/candidate-buggy.js" --case basic
```

```
== basic ==
--- expected (stdout)
+++ actual (stdout)
@@ -1,4 +1,4 @@
 alice: PASS
 bob: FAIL
-carol: PASS
-passed 2 of 3
+carol: FAIL
+passed 1 of 3
```

## Commands

### `arena record` — capture the original's behavior into a tape

```bash
arena record --out tape.json --cases cases.json -- <original> [args...]
arena record --out tape.json -- <command...>            # single ad-hoc case
```

- `--cases` is a JSON array of `{ id, argv, stdin }`. `argv` and `stdin`
  default to `[]` and `""`.
- Without `--cases`, the command after `--` runs once as a single case
  (`case-1`).
- `--timeout <ms>` (default 5000) is the per-case timeout. The original
  must behave — a timeout or spawn error during recording is an error,
  because a tape cannot record "did not run" as expected behavior.

### `arena run` — replay the tape against every candidate

```bash
arena run --tape tape.json --candidates <bin...> [--jobs N] [--timeout MS]
```

Prints one live line per candidate as it finishes (`<bin>: 5/7 passed`)
and a summary. Each candidate is one shell-quoted string, e.g.
`"node rewrite.js"` or `"/usr/local/bin/tool --fast"`. Relative file
paths in the command are resolved against your current directory before
the run, so they still work inside the candidate's temp dir.

`arena run` exits 0 once the replay finished — failures are data, not
errors. Use `arena rank` as the gate.

### `arena rank` — leaderboard + winner

```bash
arena rank --tape tape.json --candidates <bin...> [--threshold PCT] [--jobs N] [--timeout MS]
```

Prints a leaderboard (rank, candidate, pass/total, pass %, failing case
ids) and picks the winner: highest pass rate, ties broken by fewest
failing cases, then by name.

Exit code: **0** if the winner passes at least `--threshold` percent
(default 100), **1** otherwise — so `arena rank` drops straight into CI.

### `arena diff` — show what a candidate got wrong

```bash
arena diff --tape tape.json --candidate <bin> [--case <id>]
```

Unified-style diffs of expected vs actual stdout/stderr, plus the exit
code, for the failing cases (or one `--case`). If the candidate passes
everything it says so.

### `arena --help` / `arena --version`

## Tape format

```json
{
  "version": 1,
  "command": ["node", "original.js"],
  "createdAt": "2026-11-27T10:00:00.000Z",
  "cases": [{ "id": "basic", "argv": [], "stdin": "alice,85\nbob,42\ncarol,60\n" }],
  "results": [{ "id": "basic", "stdout": "alice: PASS\n...", "stderr": "", "code": 0 }]
}
```

A tape is plain JSON: the original command, the case definitions, and
the recorded stdout/stderr/exit code per case. You can hand-write one,
check it into the repo next to the code, and replay it forever. `results`
is what the original did; a candidate passes a case only when its
stdout, stderr **and** exit code all match, within the timeout.

## How it differs from single-rewrite checkers

| | single-rewrite checker (e.g. `behave`) | migrate-arena |
|---|---|---|
| Candidates | 1 | N, in one run |
| Replay | sequential | parallel across candidates |
| Verdict | pass/fail for that rewrite | leaderboard + a picked winner |
| CI gate | per-rewrite | `--threshold` on the winner |

The point is the workflow: spawn N agents in parallel, each producing
a candidate rewrite; record the original once; run the arena; ship the
winner. The bundled `SKILL.md` teaches an agent exactly that loop.

## Limitations (honest, v1)

- **Black-box only.** Judged on stdin/stdout/stderr/exit code. A
  rewrite that produces the right output but writes the wrong files,
  hits the wrong network endpoints, or leaks resources will pass.
  File/network-effect capture is not in v1.
- **Determinism is your job.** If the original is nondeterministic
  (timestamps, random ids, unordered maps), the tape records one
  arbitrary run and every candidate fails. Make cases deterministic
  first — or seed the program.
- **Timeouts are blunt.** A case that times out counts as a failure,
  and the tape cannot record a run that takes longer than `--timeout`.
- **One temp dir per candidate**, shared by its cases. Candidates that
  race with themselves across cases are out of scope.

## License

MIT — see [LICENSE](LICENSE).
