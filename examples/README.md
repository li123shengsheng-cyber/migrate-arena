# Demo: `grade` rewritten two ways

`grade` is a tiny CLI that reads `name,score` lines on stdin and grades each
one against `--threshold` (default 60). Two candidate rewrites were produced:

- `candidate-good.js` — a real rewrite (streaming stdin, helper functions),
  behavior identical to `original.js`.
- `candidate-buggy.js` — identical to the good rewrite except for one
  character: `>` instead of `>=`. A score exactly on the threshold is
  graded FAIL instead of PASS.

Run the tournament from the repo root:

```bash
node bin/arena.js record --out /tmp/grade-tape.json --cases examples/cases.json -- node examples/original.js

node bin/arena.js rank --tape /tmp/grade-tape.json \
  --candidates "node examples/candidate-good.js" "node examples/candidate-buggy.js"
```

Expected result: the good rewrite wins 7/7; the buggy one scores 5/7,
failing `basic` (carol,60) and `threshold-70` (bob,70) — exactly the
boundary cases. Inspect the failure with:

```bash
node bin/arena.js diff --tape /tmp/grade-tape.json --candidate "node examples/candidate-buggy.js" --case basic
```
