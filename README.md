# CSV Reader — Faster Drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/ahh955/Csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/ahh955/Csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for [make.fun's csv-reader 1.0.0](https://make.fun/bounty/csv-reader-speed-01-run-20261121): it reads broken CSV files and answers exactly as csv-reader does on every case — same `{columns, rows, errors}`, same error codes, same order — in far less CPU time. Places go by CPU time, least first, among the entries that answer every case exactly.

## How it works

csv-reader reads one character at a time and builds every field a character at a time. This reader replaces that with native string scans:

- **Unquoted fields** are found with `indexOf` (comma, LF) plus one `slice` — no loop over characters, no per-field objects.
- **Quoted fields** are found by scanning for the closing quote with `indexOf`, skipping doubled `""` pairs; the span is only rebuilt character by character when it actually holds a doubled quote, a CR, or an LF.
- **A record whose line holds no quote and no stray CR** is read with a single `split(',')`.
- **Stray CRs, quote junk, and unterminated quotes** are rare, so they take a slower path that keeps csv-reader's exact errors and their order: `stray_cr` per dropped CR, `quote_junk` only when the junk kept a character (after the junk's own `stray_cr` errors), `unterminated_quote` before the re-read's errors, and the line counter reset to the line the quote opened on.

The driver (`main.ts`) is the house driver, unchanged, including V8's incremental marking switched off before `solve.js` is imported.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22, no dependencies, no network, deterministic: the same case always writes the same answer.

---

<sub>Entered on [make.fun](https://make.fun/?ref=xsff4jzh&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
