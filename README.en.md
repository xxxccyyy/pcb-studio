# PCB Studio — Zero-Dependency Local PCB Auto-Placement / Routing / DRC / Delivery (Human + AI)

[![CI](https://github.com/xxxccyyy/pcb-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/xxxccyyy/pcb-studio/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) ![Node.js ≥24](https://img.shields.io/badge/node-%E2%89%A524-blue)

A zero-dependency, fully local PCB **auto-placement / auto-routing / DRC / fabrication-delivery** tool.

> **Language note:** this file is a compact English summary. The **Chinese
> [README.md](README.md) is the canonical, fully detailed documentation**; the
> Chinese docs under `docs/` (AI manual, capability whitepaper, roadmap, case
> studies, per-round benchmark reports) are maintained continuously and may be
> ahead of this summary.

- **For humans**: double-click `index.html` — it opens self-contained in a browser. Visual editor, autorouting, copper pour, DRC/DFM checks, undo/redo.
- **For AI agents**: a headless CLI (`ai/pcb.mjs`, all-JSON stdout) + the [AI Operator's Manual](docs/AI-%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C.md) — the agent goes from netlist to a JLCEDA-openable deliverable autonomously.

## Highlights

- **Routing**: A\* maze search + PathFinder negotiated congestion; RMST (Dreyfus–Wagner) Steiner decomposition for multi-pin nets; per-net rip-up-and-reroute optimizer (Freerouting BatchOptimizer style, lexicographic accept — never regresses); chord straightening + 45° corner beautification (KiCad mergeStep idea); layer-preferred directions; 8-direction diagonal routing with enforced clearance pairs; routability-driven place→route loop (`autopcb`); optional shape-based (compressed-coordinate) patch routing for grid failures.
- **Placement**: multi-restart simulated annealing over connection cost + hard penalties (overlap / off-board / keepout), 90° component auto-rotation, grid-quantized evaluation.
- **Copper**: true polygon pour (Minkowski clearance offset + flood + contour trace), thermal reliefs, island-removal modes (KiCad semantics), grid hatch, minimum-neck elimination, stitching vias, return-via pairing for high-speed layer changes, teardrops.
- **Constraints**: per-net track width (net classes end-to-end: router → DRC → Gerber apertures → EasyEDA), differential pairs (coupled corridor + compaction + impedance solver `diffz`), length-matching serpentine tuning (`tune`), declarative `design.rules` schema (netClass / pairs / length groups / class keepout).
- **Checks**: DRC (connectivity, spacing incl. 45°, overlaps, via ring/edge), JLC DFM checklist (copper-weight aware), netlist ERC, PDN/IR-drop estimate, current-aware width sizing (IPC-2152 anchors), impedance estimator (IPC-2141), return-path and 3W reminders, export round-trip self-verification (`verify`), PNG render for AI visual self-inspection (`render`).
- **Interop**: import KiCad `.kicad_pcb` and EasyEDA Std PCB JSON; export Specctra DSN / read back SES (Freerouting round-trip); KiCad 7/8 Action Plugin (`kicad-plugin/`) drives the engine from pcbnew.
- **Delivery** (`deliver`): gated package — verify + DRC + connectivity gates → EasyEDA JSON, 8-piece Gerber (LPD/LPC pour polarity, teardrops), Excellon drill (multi-tool by hole size), IPC-D-356A netlist, SVG, BOM (JLC SMT format), pick&place CPL, PNG, fab checklist, `manifest.json` with per-artifact evidence grades.
- **Parts**: fetch real symbols & land patterns by LCSC C-number (`device`), verify existence/stock/package (`part`, `bom --check`).
- **Pedigree**: 5 production router codebases studied line-by-line (Freerouting, KiCad PNS, gEDA toporouter, OpenROAD FlexDR, pcb-rnd) and ~2,600 pages of authoritative texts (Ott, Bogatin, Archambeault, Right the First Time, PEI) distilled into the built-in rules knowledge base — every rule carries a book/page citation (`node ai/pcb.mjs rules`).

## Quick start (AI workflow)

```bash
node ai/pcb.mjs schema      # design JSON fields + common mistakes (negative documentation)
node ai/pcb.mjs rules       # routing knowledge base (reliable / conditional / myths) + JLC DFM anchors
node ai/pcb.mjs spec design.json      # validate + capacity summary; fix all findings before continuing
node ai/pcb.mjs place design.json -o placed.json
node ai/pcb.mjs route placed.json -o result.json       # --parallel/--iter-workers/--shape-patch/--blind-vias
node ai/pcb.mjs drc placed.json result.json            # errors must reach 0
node ai/pcb.mjs verify placed.json result.json         # export round-trip audit
node ai/pcb.mjs render placed.json result.json -o board.png   # look at your own board
node ai/pcb.mjs pour placed.json result.json -o poured.json   # GND pour + stitching
node ai/pcb.mjs export easyeda placed.json result.json -o jlcpcb-eda.json
node ai/pcb.mjs deliver placed.json result.json -o 交付目录 --project 板名
# or the one-shot loop:
node ai/pcb.mjs autopcb design.json -o placed.json --result result.json
```

Additional subcommands include `schem`, `device`, `part`, `bom`, `pos`, `erc`, `tune`, `diffz`, `import`, `advise`, `drop`, `pdn`, `export gerber|dsn|ses|svg|ipc356`. Exit 0 + top-level `ok` on success. See the AI manual §1 for the full table.

## Tests

`npm test` is fully green at 0.14.4: 80 core + 281 node:test + 48 book-knowledge + 17 CLI + 39 fuzz (malformed inputs, zero crashes) + 7 deep-format validations + 22 optimization locks. `npm run check` guards that the standalone `index.html` matches sources (plus a classic-script parse guard and an LF line-ending guard — source-anchor tests read the engine as raw bytes). Browser QA: `npm run test:browser` (needs Playwright; set `PCB_PLAYWRIGHT_MODULE` if not on the module path). Benchmarks: `npm run bench`, plus `tests/bench-*.mjs` micro-benches. Bit-identical A/B harness for engine changes: `.scratch/ab-diff.mjs` pattern (11-case sha256 diff).

## Development

Use **Node.js 24+** and `npm ci` for locked development-only dependencies. Runtime HTML/CLI usage remains dependency-free. Playwright is pinned in the lockfile; install Chromium with `npx playwright install chromium` before `npm run test:browser`.

`npm run build:cli` rebuilds the standalone HTML and portable CLI bundle. `npm run test:bridge` always rebuilds before HTTP/MCP end-to-end tests. `npm run bridge` also rebuilds before starting. `npm run exe` packages the Windows executable **on Windows only**. CI runs the full suite and bridge tests on Linux and Windows, plus browser regression on Linux and an actual Windows SEA smoke test. See [CONTRIBUTING.md](CONTRIBUTING.md) for the release checklist and [SECURITY.md](SECURITY.md) for the local-only trust boundary.

Edit `src/engine.mjs` (algorithm core, no DOM), `src/ui.js`, `src/index.template.html`, then `npm run build` regenerates the self-contained `index.html`. The CLI and tests import the same engine directly. Routing runs in a cancellable background Worker; the browser falls back to serial when workers are unavailable.

Limits: routing capped at 4,000,000 grid states; PNG render at 16,000,000 pixels (clear errors before allocation). Grid ≥ track width + clearance guarantees inter-net spacing DRC compliance. Known boundaries (diagonal-only shape patch, BGA-64 2-layer saturation, EasyEDA via layer-pair downgrade, etc.) are documented honestly in the Chinese README §已知限制 and per-case "遗留" sections — read them before demanding those scenarios.

## Windows executable (unsigned)

`pcb-studio.exe` ships as a **GitHub Release attachment only** (`dist/` is not in the repository). It is **not code-signed**: Windows SmartScreen may show a "Windows protected your PC" notice — that is expected (no signing certificate; honestly recorded in [docs/release-audit-20261117.md](docs/release-audit-20261117.md)). Verify the download against the attached `SHA256SUMS.txt` (`certutil -hashfile pcb-studio.exe SHA256`); do not run on mismatch and please open an Issue.

## Third-party material

The MIT license covers this project's original code and documentation **only**; it does not automatically cover bundled third-party material. Redistribution/use follows each source's own license:

- `projects/ext-icebreaker/` — original [icebreaker-fpga/icebreaker](https://codeberg.org/icebreaker-fpga/icebreaker) board (Codeberg, 1BitSquared, OSHW/CC0 declaration) plus files derived from importing it; case study: `docs/案例-外部板01-iCEBreaker.md`.
- `projects/ext-oshwhub-01/` — PCB JSON from the [STM32 最小系统](https://oshwhub.com/shaowp/STM32zui-xiao-ji-tong) project on oshwhub (author shaowp) plus derived files; licensing per the original project page.
- `projects/ext-fable-*/devices/` and LCSC-fetched symbol/footprint data — from the JLCEDA/EasyEDA public API and LCSC part pages; copyright remains with the original symbol/footprint authors.
- Router design ideas studied from Freerouting / KiCad / OpenROAD / pcb-rnd are cited `file:line` in the docs; no upstream code was copied (reference clones live outside this repository).

Rights holders who object to redistribution: open an Issue and it will be removed.

MIT licensed (see `LICENSE`); CI runs the line-ending guard, `npm run check`, `npm test`, and headless browser tests on every push.
