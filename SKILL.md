---
name: migrate-arena
description: Run a behavior tournament over N candidate rewrites of a program and ship the verified winner. Use when an agent (or several) has produced candidate rewrites/migrations and you need to know which one actually preserves the original's behavior.
---

# migrate-arena

Don't trust a rewrite. Don't trust *one* check of a rewrite. Run a
tournament: record the original program's behavior once, replay it
against every candidate in parallel, and ship the winner.

## The loop

**1. Spawn N agents in parallel, one candidate rewrite each.**

Give every agent the same brief: the original program (or file), the
target language/framework, and one rule — the rewrite must be
behavior-identical, judged only on stdin/stdout/stderr/exit code.
Different agents should take different approaches (different
libraries, different structure); variety is the point. Each agent
writes its candidate to its own file, e.g. `candidates/rewrite-a.js`.

**2. Record the original.**

```bash
arena record --out tape.json --cases cases.json -- <original> [args...]
```

`cases.json` is a JSON array of `{ id, argv, stdin }`. Write cases
that cover the behavior that matters — and especially the edges:
boundary values, empty input, invalid input, error paths, non-zero
exit codes. A case the tape doesn't cover is a bug the arena can't
catch. If the original is nondeterministic (timestamps, random ids),
make it deterministic first (seed it, freeze the clock) — a flaky
tape fails every candidate.

No cases file? `arena record --out tape.json -- <command...>` records
a single ad-hoc case.

**3. Run the arena.**

```bash
arena rank --tape tape.json --candidates "node candidates/rewrite-a.js" "node candidates/rewrite-b.js" "node candidates/rewrite-c.js"
```

Candidates run in parallel (default jobs = CPU count), each in its
own fresh temp dir, with a per-case timeout (default 5000ms). You get
a leaderboard and a winner: highest pass rate, ties broken by fewest
failing cases, then by name. `--threshold` (default 100) sets the bar
for the winner; below it, `arena rank` exits 1, so it drops straight
into CI as a gate.

**4. Inspect failures, then ship the winner.**

```bash
arena diff --tape tape.json --candidate "node candidates/rewrite-b.js"
```

`arena diff` shows unified-style diffs of expected vs actual
stdout/stderr and the exit code for every failing case. Use it to
decide whether a candidate is one fix away from winning, or genuinely
wrong. Ship the winner; keep the tape in the repo next to the code so
the next rewrite can be judged the same way.

## Reading the results

- **Winner at 100%**: ship it. The tape is now the regression suite
  for this program.
- **Winner below 100%**: read the diff. If the failures are all in
  one area, tell the losing agents exactly which cases failed and let
  them try again — one more round of the tournament.
- **All candidates at 0%**: suspect the tape, not the candidates.
  Re-run `arena run` with the original itself as a candidate; if the
  original doesn't pass its own tape, the tape is wrong (stale binary,
  nondeterminism, wrong working directory).
- **A candidate times out**: it counts as a failure. Either the
  candidate hangs (real bug) or the case needs a larger `--timeout`.

## Rules of the arena

- Candidates are black boxes. Judge only stdin/stdout/stderr/exit
  code — never read a candidate's source to decide the winner.
- One candidate, one temp dir. Candidates that write files cannot
  see each other's output, and a candidate's own cases run
  sequentially so it can't race with itself.
- Relative paths in a candidate command (`node rewrite.js`) are
  resolved against your current directory before the run.
- Never use the arena to judge a program whose behavior depends on
  the network, the clock, or the filesystem beyond its temp dir —
  v1 captures none of that, and a wrong winner is worse than no
  winner.

## Commands (quick reference)

```bash
arena record --out tape.json --cases cases.json -- <original> [args...]
arena run  --tape tape.json --candidates <bin...> [--jobs N] [--timeout MS]
arena rank --tape tape.json --candidates <bin...> [--threshold PCT]
arena diff --tape tape.json --candidate <bin> [--case <id>]
```

Exit codes: 0 done (rank winner meets the threshold), 1 rank winner
below threshold, 2 usage error. `arena run` always exits 0 once the
replay finished — failures are data, not errors.
