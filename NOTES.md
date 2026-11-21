# Sokoban solver — variant comparison

Entry: `main.ts` at the repo root is the winning variant (vA). All three
variants are original code written for this bounty (standard Sokoban
techniques: push-space search, reachable-region states, dead squares,
frozen 2x2 blocks); no public solver code was copied.

## The variants

- **vA — room decomposition + A\*** (winner). Rooms found by cutting the
  hallway's dead squares; each room solved push-optimally by A* over pushes
  with a min-cost box→goal matching heuristic. Fallbacks per room:
  A\* → BFS → greedy best-first.
- **vB — whole-level push A\*** (no decomposition). Same push-space A* on
  the full level, heuristic = sum of each box's distance to its nearest
  goal. Fallback: whole-level BFS.
- **vC — room decomposition + IDA\***. Same decomposition as vA, room search
  is iterative deepening A* (depth-first, f-bound, successors best-first,
  no immediate backtrack, per-iteration transposition table). Fallbacks:
  IDA\* → A\* → BFS → greedy.

## Practice set (kit scorer, P\* = 13/16/29/47/60)

| variant | i001 | i002 | i003 | i004 | i005 | score | wall (whole set) | deterministic |
|---------|------|------|------|------|------|-------|------------------|---------------|
| vA | 1000 | 1000 | 1000 | 1000 | 1000 | 1,000,000 | 741 ms | yes (2 runs identical) |
| vB | solved | solved | 0 (empty) | — | — | — | >5 min, killed | n/a |
| vC | 1000 | 1000 | 1000 | 1000 | 1000 | 1,000,000 | 2,045 ms | yes (2 runs identical) |

- vB solved i001 and i002, then spent 5+ minutes on i003 and hit its
  expansion caps (empty solution); it never reached i004/i005. The
  whole-level state space is the product of the rooms' — decomposition is
  what makes this task tractable. vB is out.
- vC's first build took 70 s (plain IDA* re-expands transpositions); adding
  a per-iteration transposition table (min-g, cleared each bound — safe
  because within one iteration the first visit fully explores a state's
  subtree under the bound) brought it to 2,045 ms with the same perfect
  score.

## Robustness: three fresh sets from the kit's own generator

`gen-extra-sets.mjs` drew 3 extra sets (extra-a/b/c) with fresh seeds using
the kit's `program/generator` and cross-checked every key with the
reference `solveByRooms` (all matched). Results:

| set | vA score | vA wall | vC score | vC wall |
|-----|----------|---------|----------|---------|
| extra-a (P\* 13/14/31/45/58) | 1,000,000 | 1,535 ms | 1,000,000 | 940 ms |
| extra-b (P\* 15/16/33/46/59) | 1,000,000 | 1,762 ms | 1,000,000 | 813 ms |
| extra-c (P\* 18/15/34/46/60) | 1,000,000 | 1,320 ms | 1,000,000 | 1,188 ms |

Both solve all 20 unseen levels push-optimally. vA also re-verified
deterministic on extra-a (two runs byte-identical).

## Why vA won

Practice score is tied at 1,000,000, so the pick goes by runtime, then
size (per the brief): vA is fastest on the practice set (741 ms vs
2,045 ms) and its `main.ts` is smaller (17,160 bytes vs 21,363). Its A*
is also the most predictable performer: the generator guarantees every
room is solvable by push-BFS within 250,000 states, and A* with a
consistent heuristic expands a subset of those states, so the primary
search is effectively guaranteed to finish on any set the generator can
draw — with the BFS/greedy fallbacks behind it.

## Repo size

`main.ts` 17,160 bytes + README + LICENSE + NOTES.md, well under the
1 MiB cap (variants/ and test scripts are working files, not part of the
submitted repo root — only main.ts, README.md, LICENSE, NOTES.md ship).
