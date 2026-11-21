// Sokoban solver vA: room decomposition + push-optimal A* over pushes.
//
// Architecture (own design, standard Sokoban techniques):
//  - The level is a hallway with 1-4 rooms off it. Rooms are found by cutting
//    the hallway's dead squares (a box in the hallway can never reach a goal)
//    and taking the remaining floor components that hold boxes.
//  - Each room is solved push-optimally on its own: the other rooms' boxes
//    become walls, so a room's optimum is independent. The level optimum P*
//    is the sum of the rooms' optima, so solving every room optimally scores
//    1000 points on the level.
//  - The room search is A* over pushes. A state is the sorted box squares
//    plus the player's reachable region (named by its lowest square: any two
//    player squares in one region are equivalent). Cost is pushes; the
//    heuristic is the min-cost matching of boxes to goals on BFS distances
//    (admissible: each push moves one box one square, so the matching total
//    never exceeds the pushes still needed; it is consistent, so the first
//    goal state popped is push-optimal).
//  - Deadlock pruning: dead squares (reverse reachability from the goals)
//    and frozen 2x2 blocks of walls/boxes with a box off its goal.
//  - No clock, no randomness: budgets are counted in expanded states, so two
//    runs write identical bytes. Fallbacks per room: A* -> BFS (same search
//    with h = 0) -> greedy best-first; if all fail the instance still gets an
//    (empty) answer file in the stated format.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// [dx, dy, walk letter, push letter]
const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const size = w * h;
  const wall = new Uint8Array(size).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '#') continue;
      const i = y * w + x;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

/** Squares from which a box alone can be pushed onto some goal (pulled back from the goals over open floor). */
function liveSquares(wall: Uint8Array, goals: number[], w: number): Uint8Array {
  const live = new Uint8Array(wall.length);
  const queue: number[] = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (y >= 0 && y < wall.length && !wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/** Flood the player's reachable region from `from` (walls and `occupied` in the way), stamping `seen`; returns its lowest square. */
function reach(wall: Uint8Array, occupied: Uint8Array, from: number, seen: Int32Array, stamp: number, stack: Int32Array, w: number): number {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    const up = p - w;
    const dn = p + w;
    if (up >= 0 && wall[up] === 0 && occupied[up] === 0 && seen[up] !== stamp) { seen[up] = stamp; stack[n++] = up; }
    if (dn < wall.length && wall[dn] === 0 && occupied[dn] === 0 && seen[dn] !== stamp) { seen[dn] = stamp; stack[n++] = dn; }
    if (p % w > 0) { const q = p - 1; if (wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) { seen[q] = stamp; stack[n++] = q; } }
    if (p % w < w - 1) { const q = p + 1; if (wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) { seen[q] = stamp; stack[n++] = q; } }
  }
  return low;
}

/** Whether the box just pushed to `t` sits in a frozen 2x2 block of walls and boxes with a box off its goal. */
function frozenBlock(wall: Uint8Array, occupied: Uint8Array, goal: Uint8Array, t: number, w: number): boolean {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (a < 0 || d >= wall.length) continue;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** BFS distances from every walkable square to every walkable square (ignoring boxes), as a flat matrix; Infinity when unreachable. */
function distMatrix(wall: Uint8Array, w: number): Float64Array {
  const size = wall.length;
  const dist = new Float64Array(size * size).fill(Infinity);
  const q = new Int32Array(size);
  for (let s = 0; s < size; s++) {
    if (wall[s]) continue;
    dist[s * size + s] = 0;
    let qh = 0;
    let qt = 0;
    q[qt++] = s;
    while (qh < qt) {
      const p = q[qh++]!;
      const nd = dist[s * size + p] + 1;
      const ns = [p - w, p + w, p - 1, p + 1];
      for (let k = 0; k < 4; k++) {
        const nq = ns[k]!;
        if (nq < 0 || nq >= size) continue;
        if (k === 2 && p % w === 0) continue;
        if (k === 3 && p % w === w - 1) continue;
        if (wall[nq] || dist[s * size + nq] !== Infinity) continue;
        dist[s * size + nq] = nd;
        q[qt++] = nq;
      }
    }
  }
  return dist;
}

/** Min-cost perfect matching of boxes to goals on the distance matrix (DP over goal subsets); Infinity when no bijection exists. */
function matchingHeuristic(boxes: number[], goals: number[], dist: Float64Array, size: number): number {
  const n = boxes.length;
  const full = (1 << n) - 1;
  const dp = new Float64Array(1 << n).fill(Infinity);
  dp[0] = 0;
  for (let mask = 0; mask <= full; mask++) {
    const k = popcount(mask);
    if (k >= n || dp[mask] === Infinity) continue;
    const b = boxes[k]!;
    for (let j = 0; j < n; j++) {
      if (mask & (1 << j)) continue;
      const d = dist[b * size + goals[j]!];
      if (d === Infinity) continue;
      const nm = mask | (1 << j);
      const v = dp[mask]! + d;
      if (v < dp[nm]!) dp[nm] = v;
    }
  }
  return dp[full]!;
}

function popcount(x: number): number {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

/** Shortest walk from `from` to `to` around walls and boxes, in lower LURD letters (first direction first on ties). */
function walkTo(wall: Uint8Array, occupied: Uint8Array, from: number, to: number, w: number): string {
  if (from === to) return '';
  const size = wall.length;
  const prev = new Int32Array(size).fill(-1);
  const how = new Array<string>(size);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (q < 0 || q >= size) continue;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: push square out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

type SearchMode = 'astar' | 'bfs' | 'greedy';

interface SearchResult {
  pushes: number;
  moves: string;
  expanded: number;
}

/**
 * Push-space search over one sub-level (a room, or the whole level).
 * mode 'astar': f = g + matching heuristic (push-optimal on success);
 * mode 'bfs': f = g (push-optimal, Dijkstra over pushes);
 * mode 'greedy': f = heuristic (fast, not optimal).
 * Returns null when the expansion budget runs out or no solution exists.
 */
function searchPush(sub: Level, mode: SearchMode, maxExpand: number): SearchResult | null {
  const { w, wall, goals } = sub;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(wall, goals, w);
  const dist = mode === 'bfs' ? null : distMatrix(wall, w);
  const sortedGoals = goals.slice().sort((a, b) => a - b);
  const solved = (bs: number[]): boolean => bs.every((b) => goal[b]);
  if (sub.boxes.some((b) => !live[b])) return null;

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  const keyOf = (boxes: number[], low: number): number => {
    let k = low;
    for (const b of boxes) k = k * size + b;
    return k;
  };

  // State storage.
  const sBoxes: number[][] = [sub.boxes.slice()];
  const sPlayer: number[] = [sub.player];
  const sParent: number[] = [-1];
  const sG: number[] = [0];
  const sKey: number[] = [];
  for (const b of sub.boxes) occupied[b] = 1;
  sKey.push(keyOf(sub.boxes, reach(wall, occupied, sub.player, seen, ++stamp, stack, w)));
  for (const b of sub.boxes) occupied[b] = 0;

  const bestG = new Map<number, number>([[sKey[0]!, 0]]);
  const h0 = mode === 'bfs' ? 0 : matchingHeuristic(sub.boxes, sortedGoals, dist!, size);
  if (h0 === Infinity) return null;

  // Binary heap of [f, h, counter, state, g]; lower f first, then lower h, then earlier.
  const hf: number[] = [];
  const hh: number[] = [];
  const hc: number[] = [];
  const hs: number[] = [];
  const hg: number[] = [];
  let counter = 0;
  const heapLess = (i: number, j: number): boolean =>
    hf[i]! < hf[j]! || (hf[i]! === hf[j]! && (hh[i]! < hh[j]! || (hh[i]! === hh[j]! && hc[i]! < hc[j]!)));
  const heapPush = (f: number, h: number, s: number, g: number): void => {
    let i = hf.length;
    hf.push(f); hh.push(h); hc.push(counter++); hs.push(s); hg.push(g);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(i, p)) break;
      swapHeap(i, p);
      i = p;
    }
  };
  const swapHeap = (i: number, j: number): void => {
    [hf[i], hf[j]] = [hf[j]!, hf[i]!];
    [hh[i], hh[j]] = [hh[j]!, hh[i]!];
    [hc[i], hc[j]] = [hc[j]!, hc[i]!];
    [hs[i], hs[j]] = [hs[j]!, hs[i]!];
    [hg[i], hg[j]] = [hg[j]!, hg[i]!];
  };
  const heapPop = (): [number, number, number, number] => {
    const top: [number, number, number, number] = [hf[0]!, hh[0]!, hs[0]!, hg[0]!];
    const last = hf.length - 1;
    hf[0] = hf[last]!; hh[0] = hh[last]!; hc[0] = hc[last]!; hs[0] = hs[last]!; hg[0] = hg[last]!;
    hf.pop(); hh.pop(); hc.pop(); hs.pop(); hg.pop();
    for (let i = 0; ;) {
      let c = 2 * i + 1;
      if (c >= hf.length) break;
      if (c + 1 < hf.length && heapLess(c + 1, c)) c++;
      if (!heapLess(c, i)) break;
      swapHeap(i, c);
      i = c;
    }
    return top;
  };

  const fOf = (g: number, h: number): number => (mode === 'astar' ? g + h : mode === 'bfs' ? g : h);
  heapPush(fOf(0, h0), h0, 0, 0);

  let expanded = 0;
  let found = -1;
  while (hf.length > 0) {
    const [, , s, g] = heapPop();
    if (g !== sG[s]!) continue; // stale heap entry
    if (solved(sBoxes[s]!)) { found = s; break; }
    if (expanded >= maxExpand) return null;
    expanded++;
    const boxes = sBoxes[s]!;
    for (const b of boxes) occupied[b] = 1;
    const here = ++stamp;
    reach(wall, occupied, sPlayer[s]!, seen, here, stack, w);
    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi]!;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (t < 0 || t >= size) continue;
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(wall, occupied, goal, t, w);
        let key = -1;
        let next: number[] | null = null;
        let h = 0;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((a, b2) => a - b2);
          key = keyOf(next, reach(wall, occupied, b, mark, ++stamp, stack, w));
          h = mode === 'bfs' ? 0 : matchingHeuristic(next, sortedGoals, dist!, size);
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || h === Infinity) continue;
        const ng = g + 1;
        const prev = bestG.get(key);
        if (prev !== undefined && prev <= ng) continue;
        bestG.set(key, ng);
        const idx = sBoxes.length;
        sBoxes.push(next!);
        sPlayer.push(b);
        sParent.push(s);
        sG.push(ng);
        sKey.push(key);
        heapPush(fOf(ng, h), h, idx, ng);
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;

  // Reconstruct: walk the push chain back, then replay it forward with walks.
  const path: number[] = [];
  for (let s = found; s > 0; s = sParent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = sub.player;
  let boxes = sub.boxes.slice();
  for (const s of path) {
    const nb = sBoxes[s]!;
    const from = boxes.find((b) => !nb.includes(b))!;
    const to = nb.find((b) => !boxes.includes(b))!;
    const d = to - from;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(wall, occupied, player, from - d, w);
    for (const b of boxes) occupied[b] = 0;
    moves += d === -w ? 'U' : d === w ? 'D' : d === -1 ? 'L' : 'R';
    player = from;
    boxes = nb;
  }
  return { pushes: path.length, moves, expanded };
}

/** The level's rooms: cut the dead squares of the player's row (the hallway) out of the floor; each part left holding boxes is a room. */
function roomsOf(level: Level): { squares: number[]; boxes: number[]; goals: number[]; done: boolean }[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(wall, goals, w);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: { squares: number[]; boxes: number[]; goals: number[]; done: boolean }[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (q < 0 || q >= wall.length) continue;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [], done: false });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g]! >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g]! < 0)) return null;
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

const endOf = (w: number, from: number, moves: string): number => {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
};

/** Solve one level room by room (fallback: the whole level at once). Returns the move string, or '' when unsolved. */
function solveLevel(level: Level): string {
  const rooms = roomsOf(level);
  if (rooms !== null) {
    let player = level.player;
    let moves = '';
    for (const room of rooms) {
      const wall = level.wall.slice();
      for (const other of rooms) {
        if (other === room) continue;
        for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
      }
      const sub: Level = {
        w: level.w,
        h: level.h,
        wall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player,
      };
      const r =
        searchPush(sub, 'astar', 2_000_000) ??
        searchPush(sub, 'bfs', 1_000_000) ??
        searchPush(sub, 'greedy', 500_000);
      if (r === null) return '';
      moves += r.moves;
      player = endOf(level.w, player, r.moves);
      room.done = true;
    }
    return moves;
  }
  const r =
    searchPush(level, 'astar', 2_000_000) ??
    searchPush(level, 'bfs', 1_000_000) ??
    searchPush(level, 'greedy', 500_000);
  return r === null ? '' : r.moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(parseLevel(readFileSync(join(I, id, 'level.txt'), 'utf8')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
