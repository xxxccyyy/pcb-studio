# PCB Auto-Router & Design Tool (Human + AI)

A zero-dependency, fully local PCB **auto-placement / auto-routing / DRC / fabrication-export** tool.

- **For humans**: open `index.html` in a browser — that's it. Visual editor, routing, copper pour, DFM checks.
- **For AI agents**: a headless CLI (`ai/pcb.mjs`) + the [AI Operator's Manual](docs/AI-使用手册.md) — give the agent your requirements and it designs the board autonomously and hands back a JLCEDA-openable file.

**Highlights**

- Routing: A* maze + PathFinder negotiated congestion, RMST (Dreyfus–Wagner) Steiner decomposition, per-net rip-up optimizer (Freerouting BatchOptimizer style), chord straightening (KiCad mergeStep), stall-shuffle, routability-driven place→route loop (`autopcb`) with component auto-rotation
- Placement: multi-restart simulated annealing, anchoring, keepouts, board-edge margins
- Net classes: per-net track width end-to-end (router → DRC → Gerber apertures → EasyEDA)
- Deliverables: EasyEDA Std PCB JSON (docType 3, with silkscreen designators), EasyEDA Std schematic JSON (docType 1), Specctra DSN / SES round-trip, 8-piece Gerber (copper / mask / silk pin-1 markers / outline / multi-tool drill, with pour & teardrops), BOM (JLC SMT format), pick&place CPL
- Checking: DRC, JLC fab checklist (copper-weight aware), netlist ERC, export round-trip self-verification (`verify`), PNG render for AI visual inspection (`render`)
- Parts: fetch real symbols & land patterns by LCSC C-number (`device`), verify stock/package (`part`, `bom --check`)
- 5 router codebases studied line-by-line (Freerouting, KiCad PNS, gEDA toporouter, OpenROAD FlexDR, pcb-rnd) — see `docs/`

**Quick start (AI)**

```bash
node ai/pcb.mjs schema      # design JSON fields + common mistakes
node ai/pcb.mjs rules       # routing knowledge base (reliable / conditional / myths) + JLC DFM anchors
node ai/pcb.mjs spec design.json
node ai/pcb.mjs autopcb design.json -o placed.json --result result.json --anchor U1,Y1
node ai/pcb.mjs drc placed.json result.json && node ai/pcb.mjs verify placed.json result.json
node ai/pcb.mjs render placed.json result.json -o board.png      # look at your own board
node ai/pcb.mjs export easyeda placed.json result.json -o jlcpcb-eda.json
```

Tests: `npm test` (162 checks across routing, geometry, CLI, malformed inputs, exports, and optimization). Run `npm run bench` for routing benchmarks. See the [optimization review](docs/optimization-review.md) for measurements and next priorities, or the [Chinese README](README.md) for usage details.

Development: edit `src/engine.mjs`, `src/ui.js`, and `src/index.template.html`, then run `npm run build`. The generated `index.html` remains self-contained and opens directly. `npm run check` detects stale generated output. Routing and placement run in a cancellable background Worker; the CLI imports the same engine and routing policy.

Optional browser QA: `npm run test:browser` (requires Playwright and Chromium; set `PCB_PLAYWRIGHT_MODULE` to its absolute `index.mjs` path if it is not on the module path). This tests both HTTP and direct-file use, responsiveness, cancellation during optimization, rerouting, automatic placement, imports, and literal-text rendering.

Gerber export produces eight files for two-layer boards and ten for four-layer boards, including inner copper. The browser and CLI use the same file list. Routing is limited to 4,000,000 grid states and PNG rendering to 16,000,000 pixels; oversized requests return a clear error before allocation.
