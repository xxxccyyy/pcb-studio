# Optimization review — 2026-11-06

Scope: `pcb-autorouter`, the active application in this workspace. Reference codebases under `study` and `freerouting-master` were not changed.

## Changes implemented

### Faster A* distance maps

The old heuristic propagated spatial and weighted layer distances through a growing JavaScript queue, allocated a neighbor array for every visit, and could revisit cells when cheaper distances arrived.

The replacement uses a session-owned `Int32Array` queue. It runs a multi-source unit-cost BFS within each layer, then performs forward and backward passes along the layer axis. With obstacles excluded from this lower bound, planar movement and layer changes commute: the result is the minimum planar distance to a goal plus the discounted layer-change cost. Manhattan and diagonal modes retain their previous lower bounds. Each cell enters the queue at most once, and work is linear in the number of grid states. The queue retains four bytes per state for the session.

The regression test compares every state against an independent distance formula across 1/2/4 layers, one-row and one-column grids, fractional via costs, both direction modes, and reused buffers. The comparison benchmark also checks the old and new maps within Float32 tolerance.

### Correct via clearance maps

`rebuildViaInf` previously assigned the row index to `gx` and the column index to `gy`. It also compared a distance in millimetres with a radius measured in grid cells. This misplaced or omitted exclusion cells, especially away from the board diagonal and on non-unit grids.

`markViaInfluence` now converts a radius in millimetres into grid units once and uses the correct row/column coordinates. Tests check every cell against a millimetre-distance oracle on rectangular grids at four grid sizes, including board edges and overlapping same-net/different-net vias.

### Broader, exact track clearance checks

The previous general track check only compared diagonal segments with other diagonal segments. An orthogonal crossing with `result.overuse = []` produced no error. The manual-track checker also sampled a maximum of 24 intervals, which could skip a short crossing track.

The general check now covers all nonzero same-layer segments using exact segment-to-segment distances and `(widthA + widthB) / 2 + clearance`. Sorting by layer and minimum X lets it stop scanning beyond the possible clearance range; bounding boxes prune additional pairs. Dense overlapping geometry can still require quadratic work.

Via-to-track checks now include the track's half-width. For example, a 1 mm track passing 0.9 mm from a via centre was previously accepted with a 0.8 mm via and 0.2 mm clearance; it is now rejected because the required centre distance is 1.1 mm.

Both the orthogonal-crossing and via-width fixtures were checked against the saved original implementation: each previously reported zero errors. The new tests cover these failures, mixed track widths, exact clearance boundaries, layer separation, same-net exclusions, and comparison with an independent random segment-distance oracle.

## Local measurements

Windows, Node v24.21.0; original source saved before editing. The final comparison ran after the test suite completed. These timings are local measurements, not predictions for every board.

Heuristic: 240 × 160 cells, two goals, diagonal mode; median of seven samples with five calls per sample after warmup. Buffers are allocated outside the timed calls.

| Layers | Via cost | Before (ms) | After (ms) | Speedup |
|---|---:|---:|---:|---:|
| 2 | 15 | 20.873 | 5.448 | 3.8× |
| 2 | 150 | 13.322 | 2.582 | 5.2× |
| 4 | 15 | 21.084 | 3.927 | 5.4× |
| 4 | 150 | 19.034 | 2.902 | 6.6× |

Full session plus two optimization passes, default options; median of five runs after one warmup, alternating the old and new implementations. DRC runs outside the timed section.

| Bundled example | Before (ms) | After (ms) | Time reduction | Connected pads / vias / track length (mm), both versions |
|---|---:|---:|---:|---|
| 555 (`e555`) | 277.37 | 185.38 | 33% | 22 / 0 / 129.462 |
| LED (`eled`) | 253.26 | 223.71 | 12% | 25 / 0 / 97.500 |
| MCU (`emcu`) | 535.17 | 440.88 | 18% | 33 / 1 / 294.196 |

All three results completed and had zero DRC errors. Connectivity, via counts and track lengths matched the originals. Larger or more congested boards may behave differently, particularly where corrected via clearances change the available routes.

Run `npm run bench` to measure the current implementation. To compare with a saved earlier version:

```text
npm run bench -- /absolute/path/to/previous/index.html
```

## Initial-pass validation

`npm test`: **139 checks passed** — 80 core, 9 new geometry regressions, 15 CLI, 17 malformed-input cases, 6 export syntax checks, and 12 optimization checks. The standalone HTML and zero-dependency runtime are preserved. Browser interaction and fabrication of physical boards were not tested in the initial pass; the browser results from the second pass are recorded below.

## Second pass — broader optimization

The four priorities from the initial review are now implemented. Application source lives in `src/`; `index.html` is the generated, self-contained distribution. No runtime dependencies were added.

### Architecture and browser responsiveness

- `src/engine.mjs` is imported directly by the CLI and core tests. It contains the shared routing policy used by the CLI, browser Worker and automatic placement/routing loop.
- `scripts/build.mjs` embeds the engine, Worker handler, Worker client and UI into the standalone HTML. `npm run check` fails when it differs from source. The standard test command includes this check.
- Layout, routing, optimization and single-net rerouting run in a persistent Blob Worker. Stop/Esc terminates the active Worker, including an A* search or optimization pass, and rejects the pending request. The next run starts a fresh session. Request IDs prevent old replies from affecting new work.
- Controls that edit the design are disabled while routing. Worker failures and cancellation restore controls. Completed sessions retain single-net rerouting. Rejected optimization results restore a session snapshot, including occupancy and via influence maps.

### Additional performance work

- Cache each net's Steiner decomposition for the session instead of recomputing it on every reroute.
- Compute optimizer lower bounds once, and compute detour ratios before sorting instead of repeatedly solving them inside the comparator.
- Precompute via/pad legality on the grid, replacing a pad scan for each attempted via.
- Compress collinear paths before geometry checks and use actual per-net widths in negotiation checks.
- Cache placement net groups outside the annealing cost function. Placement uses a reproducible seeded generator (default 42; the engine accepts `opts.seed`).

Comparison with the saved source immediately before this second pass, same benchmark procedure as above, Node v24.21.0:

| Example | Before second pass (ms) | After (ms) | Time reduction | Connected / vias / length (mm), both versions |
|---|---:|---:|---:|---|
| 555 | 161.49 | 143.76 | 11% | 22 / 0 / 129.462 |
| LED | 150.65 | 118.20 | 22% | 25 / 0 / 97.500 |
| MCU | 475.15 | 327.70 | 31% | 33 / 1 / 294.196 |

The two passes were measured separately; absolute times between their tables reflect different runs and should not be directly combined. These examples completed with zero DRC errors. Improved constraint enforcement can produce different paths on other designs.

### Geometry and manufacturing correctness

- Exact segment-to-circle/rectangle checks replace sampling for pad and keepout crossings, with pad layer filtering and actual net widths.
- Manual tracks, their layer-change vias, and stitching vias are fixed routing obstacles. They retain their owning net's access. Manual vias are included in CLI DRC, and loading/saving CLI results no longer repeatedly appends manual entries.
- Overlapping pad influence regions cannot silently overwrite a different net's exclusion region.
- The minimum grid is rounded upward, preventing rounding from producing a spacing below the requested clearance.
- Placement now snaps and clamps entire components as rigid groups. The original implementation could change SOIC/DIP pin spacing by independently snapping or clamping pads. Tests verify pairwise pad distances through rotations, edge clamping and anchored placement. Imported projects also retain their physical pad coordinates; malformed imports leave the active project intact.
- Rotation metadata accumulates correctly across placement rounds, and grid translations update component position metadata.
- Four-layer routing statistics count inner-layer length. Four-layer Gerber export includes both inner copper files and uses the actual last layer for bottom copper/mask/silkscreen. Browser and CLI now share the complete file list: eight files for two layers, ten for four layers.
- Candidate routing results with DRC errors are marked partial and counted in candidate scoring.

### Validation and server handling

- Shared design validation rejects malformed arrays, duplicate IDs, nonfinite dimensions, invalid shapes/layers and unusable via dimensions. Result geometry is validated before consumption.
- Routing grids above 4,000,000 states and raster images above 16,000,000 pixels fail before allocating their large buffers.
- CLI parsing handles repeated positional values, boolean flags such as `--no-stitch`, fractional via costs, and filenames after `--`. Missing values, unknown or duplicate flags and invalid numeric ranges produce JSON errors with a nonzero status.
- The preview server catches malformed URI escapes, checks lexical and real-path containment (including Windows junctions), rejects dotfiles, supports GET/HEAD and conditional caching, and streams files. It remains bound to loopback when launched from the CLI.
- Imported net names and DRC text are escaped before insertion into browser HTML.

### Final validation and development commands

- `npm test`: **162 checks passed** — 80 core, 9 geometry, 17 reliability, 6 HTTP including the parent test, 15 CLI, 17 malformed inputs, 6 export syntax checks, 12 optimization checks. Generated-output consistency is also checked.
- `npm run test:browser`: **16 checks passed in real headless Chromium**, covering HTTP and direct-file startup, responsive routing, single-net rerouting, Stop during search, cancellation during optimization, background automatic placement/routing, pitch-preserving imports, literal text rendering and atomic rejection of malformed imports.
- `npm run bench -- /absolute/path/to/previous/index.html`: reproducible source comparison; `npm run bench` measures the current version.
- `npm run build`: rebuild the distributable after editing source. `npm run check`: detect generated-output drift.

Browser QA needs a separate Playwright/Chromium installation. Set `PCB_PLAYWRIGHT_MODULE` to Playwright's absolute `index.mjs` path when it is not on the module path. Playwright is only a development check; the application and standard tests retain their zero-dependency runtime.

Remaining product limits include grid-based routing, stripe-based copper pours, through vias only, and no differential-pair or length-matching rules. These changes do not establish fabrication readiness for every design; the measured boards and export regressions are the concrete validation scope. Physical fabrication and external component-library APIs were not exercised in this pass.

## Search allocation pass — 2026-11-08

Scope: only the active application; reference projects were left unchanged. No runtime dependencies or routing-policy changes were introduced.

### Implementation

- A* now keeps heap priorities and state indices in parallel numeric arrays rather than allocating an object for every insertion. The arrays are reset between searches. Priorities remain JavaScript Numbers, and insertion order, `<=` upward comparisons and strict `<` downward comparisons are unchanged, including equal-cost ties.
- Neighbor enumeration reuses three ten-slot typed buffers (up to eight planar moves and two layer changes), instead of allocating an outer array and one tuple per neighbor for every expanded state. Order and boundary checks are unchanged. Searches are synchronous and non-reentrant within a session; that invariant must be revisited if callbacks or recursive searches are added later.
- Via influence rebuilding no longer clears the output just before overwriting every cell. For a board with no vias, an already-empty influence map is reused. When the last via disappears, the old map is cleared once. Snapshot restoration still rebuilds from the restored via sets, including both empty-to-occupied and occupied-to-empty transitions.

### Validation

- `npm.cmd test`: **227 checks passed**, including standalone build consistency and **16 new search regressions**.
- Fifteen frozen-baseline cases cover all three bundled examples, Manhattan/diagonal movement, fractional via cost, one/two/four layers, congestion, keepouts, fixed manual tracks, mixed widths, and paired/high-speed nets. Each case compares initial routing, two optimization passes, and snapshot restoration followed by single-net rerouting against the pre-change implementation. Exact paths, vias, cell insertion order and occupancy conflicts are included in SHA-256 comparisons; elapsed time is excluded.
- An additional regression exercises occupied-to-empty-to-rerouted and empty-to-occupied snapshot transitions for the via map.
- The reviewer independently compared 50,000 mixed heap operations (including equal priorities) and 1,596 neighbor enumerations from the old and new kernels; output order matched.
- Browser QA was not rerun for this pass: the project could not resolve a Playwright module. The generated standalone HTML was rebuilt and its source consistency verified; real-browser timing and memory usage were not measured.

### Local performance comparison

Windows, Node v24.21.0. The final comparison ran after the full tests had completed, using the saved pre-change standalone HTML. Full session plus two optimization passes; one warmup and median of five measured runs per version, alternating execution order. DRC is outside the timed region.

| Example | Before (ms) | After (ms) | Observed time reduction | Connected / vias / length (mm), both versions |
|---|---:|---:|---:|---|
| 555 | 192.29 | 141.21 | 26.6% | 22 / 0 / 129.462 |
| LED | 160.74 | 134.20 | 16.5% | 25 / 0 / 97.500 |
| MCU | 309.47 | 302.64 | 2.2% | 33 / 1 / 294.196 |

All three completed with zero DRC errors. The MCU difference is small enough to treat as near-neutral rather than a reliable speedup. These are local observations, not guarantees for larger designs or browsers. The distance-map kernel was not changed in this pass; its isolated benchmark timings varied despite identical code, illustrating timing/JIT noise. No distance-map speedup is claimed.

Reproduce from the workspace with the preserved baseline (the baseline copy is only for local comparison, not a runtime dependency):

```powershell
Set-Location 'D:\PCB软件设计\pcb-autorouter'
node tests/bench-heuristic.mjs '..\.scratch\perf-before-20261108.html'
```


---

## 附录：第十轮后 A* 热路径深度优化（2026-11-08）

### 背景与证据

第九轮剖析（n130 BTB，prof9/*.cpuprofile，875.6s 样本）定位热点：astar 45.9% + 堆 pop 14.1% + fillDistanceMap 28.0% = 88%。同轮的启发式图缓存假设被 A/B 证伪（命中率 1.3%——RMST 逐边目标集含动态布线格）后回退，roadmap 指向内环。

### 本轮三项改动（全部保持搜索语义逐位一致）

1. **堆类型化数组化**：`heapStates/heapCosts` 从普通 JS 数组（push/pop 扩容+装箱）改为预分配 Int32Array/Float64Array + 容量翻倍增长；筛选（sift-up/down）算法逐行保持一致 → 弹出顺序逐位一致。
2. **ownStamp 成员戳**：热路径的 `net.cells.has()`（Set 哈希查询，每邻居 1-3 次 + 过孔环 12×L 次）改为会话级 Int32Array 代数戳——每次 astar 调用 O(|net.cells|) 写戳，O(1) 查询。不采用 cellOwner（它是"首个占用者"，软协商重叠时语义不等价）。
3. **fillDistanceMap 闭包内联**：visit 闭包（每图 ~1M 次调用）手动内联，邻居访问顺序逐位保持。

### 验证

- **正确性**：n130 优化前后产物**走线几何逐位一致**（status/connected/vias/trackLen/每段坐标全同）；npm test 259 项全过。
- **性能**（严格串行计时，无并发污染——注意 R9 L32：并发基准不可用）：

| 基准 | 优化前 | 优化后 | 提速 |
|---|---:|---:|---:|
| n130 BTB（119p，0.25 grid，15.6min 级） | 858-935s（噪声带） | **768.9s** | ~12% |
| n83 PLC 光耦阵列（82p） | 203.4s | **185.1s** | 9.0% |
| n110 邮票孔拼板（98p） | 112.9s | **108.3s** | 4.1% |

- 提速幅度与剖析占比一致（堆+成员戳消掉 astar/.pop 的装箱与哈希开销；距离图内联吃掉部分 BFS 开销）。中型板收益较小——其热点里禁布缓冲/美化占比较高。

### 未做与理由

- **启发式图缓存**：R9 已证伪（命中率 1.3%），不重试。
- **双向 A* / 增量启发式**：行为级变更，无法保证逐位一致，收益需重跑全部回归——列 roadmap。
- **cellOwner 替代 Set.has**：语义不等价（首个占用者 vs 成员集合），否决。


---

## 附录 2：十轮教训驱动的 L39 零格焊盘修复（2026-11-08）

### 验证过程（先验证后优化）

1. **L18 复核（证伪）**：n67 未连通 GND 焊盘 inPour 全 false——铺铜未覆盖，DRC 正确。"铺铜豁免连通契约"的优化会制造假绿，不实施。
2. **L17 松弛实验（无效）**：软阶段跨影响区放行（+60/格）对 n59 无效——S1/S5/D0 从未进入 astar 失败日志。
3. **插桩追因**：RMST/Prim 的 `src.length===0` → 布局后 **U1-2/11/14/23 四焊盘 padCells 为空**——SOIC 旋转后 0.5mm 短边横向，放置量化落在格界上，0.5 < grid 0.6 → 不含任何格心 → 焊盘对本网完全不可达。
4. **修复（autoPlace 写回薄焊盘格心保障）**：薄于栅格的轴向，中心相位距最近格心线 > 半宽时半格微移（≤grid/2，制造无差异）。零格焊盘残留 0。
5. **spec 门**：新增零格覆盖检查（锚定薄焊盘的 spec 级拦截）。

### 效果

| 项目 | 修复前 | 修复后 |
|---|---|---|
| n59 MAX7219（R6 四轮残留） | 41/47（种子/轮数/锚定均不可救） | **47/47 complete / DRC 0 / 15.1s** |
| n67 USB Hub（R10 残留） | 52/66 | **66/66 complete / DRC 0** |
| n83/n110/n143/n145/n151 | 全绿 | 全绿（无回退） |

npm test 259 项全过。同一 bug 曾伪装成"影响区墙"（R6 L17）与"电源 highway 物理限制"（R6 L18）两个错误理论——几何级复核（padCells/inPour）是唯一可靠的归因手段。


---

## 附录 3：十轮优化全量审计（2026-11-08）

对 R1-R10 全部声称的优化做源码存在性 + 测试锁定 + 回归三重审计。

### 审计结果：33 项检查，32 在位，1 缺口（已补）

| 轮次 | 优化项 | 代码 | 永久测试 |
|---|---|---|---|
| R1 | 罚金常数下限/边缘间距罚/SOIC 参数化/板边禁布/checkGeoSpacing/hMap 过孔代价/组吸附/钻孔多刀 | ✓×8 | 测试 1-10 |
| R5 | 历史最优保留/货架边距 1.5/过孔判距容差/停滞重启/FINEPITCH | ✓×5 | router.test 确定性测试等 |
| R6 | 逃逸口袋罚/viaHoleBlocked×3 处 | ✓ | 测试 13/14ab |
| R7 | spec 门五项扩展 | ✓ | cli.test spec 用例 |
| R8 | 圆焊盘方形化/半孔豁免（生成器自检） | ✓ | 测试 17ab |
| R10 | 禁布缓冲带/真铜格豁免/null-net | ✓ | 测试 18ab |
| 深优 | 类型化堆/ownStamp/距离图内联/真铜属主/薄焊盘格心 | ✓ | 逐位一致 A/B + 测试 19ab（新增） |

### 审计发现与修复

1. **spec 出板检查缺半孔豁免（真缺口，已修）**：R8 曾声称"半孔豁免已同步实现于两处"，
   实际只落在了生成器自检——`ai/pcb.mjs spec` 的出板检查会误拦铸铜半孔 spec。
   已补齐并验证（半孔 spec 通过/普通出板仍拦截）。
2. **薄焊盘格心保障（L39）缺永久测试（已补）**：测试 19ab（模型级零格=0 + 行为级全链）。
3. **回退项复核**：启发式缓存（R9）与密度自适应罚（R5）均已干净回退，无残留代码
   （密度自适应仅存 A/B 证伪注释留档）。
4. 审计脚本自身的 2 个特征码误报（环宽字符串格式/钻孔分组实现名）——功能实际在位。

### 遗留观察（不构成缺口）

- 永久测试编号存在空洞（11/12/16）：历史跳号与证伪未落地项，非缺测试。
- L2/L10（历史最优保留/停滞重启）的锁定在 router.test.mjs 确定性测试与回归套件，
  verify-optimizations 中无独立用例——行为级 A/B 已在 R5 记录。
