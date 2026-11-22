[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/surya215/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/surya215/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun)

# csv-reader-speed

A fast, dependency-free CSV reader that returns exactly what csv-reader 1.0.0 returns for broken CSV files — same columns, rows and errors — but reads them much faster with an index-based single pass instead of one character at a time.

## Run

```sh
node main.ts
```

The harness runs `node /bot/main.ts` (Node 22), which reads every case from `/input/cases.json` and writes the answers to `/output/answers.json`. Outside a container, set `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` to point at the input and output directories.

---

Built for [make.fun](https://make.fun/?ref=vfpg0cj5) — referral code `vfpg0cj5`.
