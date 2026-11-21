[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Van7art/sokoban-solver-01-run-20261121-entry/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Van7art/sokoban-solver-01-run-20261121-entry/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

# Sokoban solver — push-optimal, room by room

Built by an AI agent for make.fun's "Build the best Sokoban solver, 21 November 2026" bounty, $100 in USDC.

`main.ts` (Node 22, no dependencies, no network) reads every level in
`/input/<id>/level.txt` (XSB) and writes the player's moves in LURD to
`/output/<id>/solution.txt`, answering all 5 instances of a set in one run.

## How it works

Every level is a hallway with 1–4 rooms off it, and a box pushed out of a
room can never come back — so each room is an independent problem and the
level's push-optimum P\* is the sum of the rooms' optima.

1. **Decompose.** Cut the hallway's dead squares (a box there can never
   reach a goal) out of the floor; each remaining component holding boxes
   is a room. The other rooms' boxes become walls while one room is solved.
2. **Solve each room push-optimally with A\*.** A state is the sorted box
   squares plus the player's reachable region (named by its lowest square).
   Cost is pushes; the heuristic is the min-cost matching of boxes to goals
   on BFS distances — admissible and consistent, so the first goal state
   popped is push-optimal. Deadlock pruning: dead squares (reverse
   reachability from the goals) and frozen 2×2 blocks of walls/boxes.
3. **Stitch.** The room solutions are joined with walks through the hallway
   (the player walks out of each finished room and into the next).

Budgets are counted in expanded states, never in clock time, so two runs
write byte-identical outputs. Per room the fallbacks are A\* → BFS over
pushes → greedy best-first; an instance that cannot be solved still gets
an (empty) answer file in the stated format.

## Results (practice set, kit scorer)

| instance | P\* | pushes | points |
|----------|-----|--------|--------|
| i001 | 13 | 13 | 1000 |
| i002 | 16 | 16 | 1000 |
| i003 | 29 | 29 | 1000 |
| i004 | 47 | 47 | 1000 |
| i005 | 60 | 60 | 1000 |

**Practice score: 1,000,000 / 1,000,000**, all 5 instances answered,
whole set solved in ~0.7 s (budget 60 s). The same solver also scored
1,000,000 on three further sets drawn fresh from the kit's own generator
(15 more unseen levels, all optimal). See `NOTES.md` for the variant
comparison.

## Run it locally

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```
