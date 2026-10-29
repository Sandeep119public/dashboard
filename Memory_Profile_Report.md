# Memory profile and optimization report

## Scope

- Commit measured: `c144be2890fcc4780c1d284094acdbec1a3f1234` (`c144be2`, the deployed revision). The array-duplication audit in the final section was measured against `1469e5208561f6bee86e999526d5a3beb148e5c2` (`1469e52`) plus the uncommitted lazy-10-second change described there.
- Dataset: `futures-trades-monthly-BTCUSD-2026-08.csv.zip`, 66,245,295 bytes compressed, 391,774,302 bytes uncompressed, **7,440,458 rows across 31 days**.
- Node: v20.18.0, win32 x64. Browser: Chrome 156.0.8078.48, 1366×900, `--enable-precise-memory-info`.
- No push or deployment was performed. The working tree contains the measured changes only.

## Method

### Node data-pipeline profile

- The ZIP is opened with `fs.openAsBlob`, so the 66 MB archive is not copied into the JS heap. This matches the browser's `File`-slice streaming model.
- A worker thread samples process-wide RSS every 5 ms, so synchronous phases (`JSON.stringify`, gzip, `JSON.parse`) still get a peak reading. Heap counters are per-isolate in a worker, so the main thread records `heapUsed`/`external`/`arrayBuffers` at each phase boundary.
- `global.gc()` is called twice before every retained-memory reading. Retained values are after explicit GC; phase peaks are before/without forced GC unless noted.
- Phases: import → combined multi-timeframe build (exact copy of `rebuildCombined()`) → workspace stringify → gzip → release → gunzip → parse → extract → rebuild.
- Heap snapshots were taken after import, after the combined build, and after stringify. Node 20.18 on Windows crashes when `v8.writeHeapSnapshot` runs with an open file-backed Blob, so snapshot runs use a `File` over a `Buffer`; retained heap matched the Blob run (91.9 MB vs 92.0 MB). Snapshot totals include the 63.2 MB input buffer and are therefore not directly comparable to RSS.

### Browser profile

- The app was served from the working tree at `http://127.0.0.1:8123/` and driven with Playwright.
- Retained heap is `Performance.getMetrics().JSHeapUsedSize` after `HeapProfiler.collectGarbage`.
- Peak heap during save/load/import is polled with `Runtime.getHeapUsage` every 10 ms; the save benchmark also hooks stream enqueue/`JSON.stringify`/`Blob` construction, and the load benchmark hooks `JSON.parse`.
- Allocation hot spots use `HeapProfiler.startSampling` with collected-object tracking enabled. That reports **total allocated bytes**, including garbage, not live peak.
- Chrome is multi-process. Page-heap numbers are not process RSS and do not include renderer/GPU/native buffers.

## Baseline: retained memory (Node, after GC)

| Phase | Heap used | Heap total | RSS | External |
|---|---:|---:|---:|---:|
| Initial | 3.6 MB | 6.2 MB | 41.4 MB | 1.8 MB |
| After import (31 days) | **92.0 MB** | 130.2 MB | 159.4 MB | 1.9 MB |
| After combined build | **166.6 MB** | 205.5 MB | 249.3 MB | 3.5 MB |
| After workspace stringify | 280.7 MB | 332.8 MB | 376.2 MB | 3.5 MB |
| After gzip | 281.3 MB | 320.2 MB | 402.5 MB | 23.6 MB |
| After releasing JSON string | 166.6 MB | 205.5 MB | 287.3 MB | 23.6 MB |
| After restore + rebuild | 154.6 MB | 200.5 MB | 312.7 MB | 23.6 MB |

Combined build adds **74.6 MB** of retained heap. The workspace JSON is **60,125,765 characters (57.3 MB)** and gzip is **21,139,233 bytes (20.2 MB)**.

## Baseline: peak RSS by phase (Node)

| Phase | Duration | Peak RSS |
|---|---:|---:|
| Import | 8,035 ms | 234.3 MB |
| Combined build | 229 ms | 316.1 MB |
| `JSON.stringify` workspace | 488 ms | 371.3 MB |
| gzip (sync) | 2,145 ms | **552.9 MB** |
| gunzip | 231 ms | 497.7 MB |
| `JSON.parse` | 345 ms | 497.7 MB |
| Restore rebuild | 271 ms | **620.0 MB** |

## Heap-snapshot composition

| Snapshot | Total self | Arrays | Strings | Heap numbers | Native |
|---|---:|---:|---:|---:|---:|
| After import | 155.2 MB | 72.6 MB | 0.5 MB | 15.8 MB | 63.2 MB |
| After combined build | 231.2 MB | **143.0 MB** | 0.5 MB | 19.9 MB | 64.7 MB |
| After stringify | 345.4 MB | 143.0 MB | **114.5 MB** | 19.9 MB | 64.7 MB |

Deltas: combined build adds **+70.4 MB of array backing stores** and **+4.1 MB of heap numbers**. Stringify adds **+114.5 MB of string data**, confirming V8 stores the ASCII-plus-en-dash JSON as a two-byte string rather than the 57.3 MB character count.

## Browser baseline

| Measurement | Value |
|---|---:|
| Heap before import (after GC) | 7.9 MB |
| Heap after import (after GC) | **152.5 MB** |
| Peak polled heap during import | **267.8 MB** |
| DOM nodes after import | 21,268 |
| Total sampled allocation during import | **1,852.7 MB** |
| — `aggregateDay` | 719.9 MB |
| — `parseCsvStreamByDay` | 513.2 MB |
| — `rebuildCombined` | 205.0 MB |
| — `parseTimestampRange` | 85.7 MB |
| — `parseNumberRange` | 40.6 MB |
| Workspace save (old path) | 2,367 ms, 20.2 MB |
| Save allocation attributed to `saveWorkspace` | 114.7 MB |
| Save peak live heap (old path) | **275.1 MB** (Δ +123.0 MB) |
| Workspace load (old path) | 695 ms |
| Load peak polled heap (old path) | **351.0 MB** |
| Heap at `JSON.parse` return (old path) | **366.7 MB** |
| Load allocation total (old path) | 420.1 MB |

## Ranked opportunities

1. **Stream workspace JSON directly into gzip — implemented.** Removes the whole-payload string, its Blob copy, and the associated peak. Estimated impact: large (Node peak RSS −234 MB; browser live heap −62 MB). Risk: low; output is byte-identical and covered by tests.
2. **Stream gzip decompression and release text/document before rebuild — implemented.** Avoids the extra compressed-buffer Blob and removes the JSON text/document from the reachable set while combined arrays are rebuilt. Estimated impact: modest (−5 to −20 MB browser peak). Risk: low.
3. **Eliminate per-day/combined duplication — partially implemented.** About **70 MB** of retained array storage is duplicated because `rebuildCombined()` copies every per-day bar/profile/event array into flat combined arrays. The per-day copies are required for workspace export, date replacement, and partial imports, so wholesale removal is unsafe. The follow-up audit (final section) measured each combined component and implemented the largest low-risk slice: the combined 10-second timeframe is now built lazily, saving **32.4 MB** retained and about **50 MB** of rebuild peak. Profile/event/histogram laziness and typed-array views remain open. Impact: high; risk: high for the remaining slices.
4. **Reduce aggregation temporary allocation — not implemented.** `aggregateDay` accounts for 720 MB and the parser for 513 MB of sampled allocation. Reusing per-timeframe accumulators or building bars from typed columns could lower peak RSS. Impact: high; risk: medium-high because bar insertion order and exact numeric output must be preserved.
5. **Avoid per-row line slicing in the CSV stream — not implemented.** The fast path still creates one short string per row (`pending.slice`). Parsing directly from the pending buffer with offsets could cut allocation churn. Impact: medium; risk: medium.
6. **Convert profile/event/histogram columns to typed arrays — not implemented.** Could save several MB of retained heap, but JSON serialization shape and `.push`-based consumers would need changes. Impact: low-medium; risk: medium.

## Implemented optimization 1: streaming workspace export

New module `src/app/workspace-export.js`:

- `workspaceJsonText()` keeps the legacy single-string form for the no-`CompressionStream` fallback.
- `createWorkspaceJsonStream()` emits the exact same JSON text one day at a time: same key order, same per-entry `JSON.stringify`, same UTF-8 bytes.
- `saveWorkspace()` pipes that stream through `CompressionStream('gzip')`; it never materializes the 57.3 M-character payload.

### Node before/after (3 runs, identical input and gzip implementation)

| Path | Peak RSS runs | Mean | Duration runs | Output |
|---|---:|---:|---:|---|
| Old: stringify + Blob + gzip | 505.6, 530.5, 540.2 MB | **525.4 MB** | 2,818.8, 2,788.1, 2,795.6 ms | 20.2 MB |
| New: stream + gzip | 292.4, 286.2, 296.5 MB | **291.7 MB** | 2,698.5, 2,701.9, 2,727.2 ms | 20.2 MB |

Peak RSS reduction: **233.7 MB (−44.5%)**. Retained heap after each path returned to ~93.3 MB. Both paths produced the same SHA-256 (`b8d25e9edf3d8268f59a58c6a96b4f17c4018254ffe42c944c0772375f35cf2b`).

### Browser before/after (same app, old save function vs streaming save)

| Measurement | Old | New |
|---|---:|---:|
| Save duration | 2,260–2,367 ms | 2,223–2,802 ms |
| Downloaded size | 20.2 MB | 20.2 MB |
| Peak sampled live heap | **275.1 MB** | **213.2 MB** |
| Peak delta over pre-save heap | +123.0 MB | +61.1 MB |
| Largest enqueued chunk | 57.34 MB | 3.89 MB |
| Heap after save + GC | 152.2 MB | 152.2 MB |

The browser delta is smaller than the Node RSS delta because the browser measurement excludes Blob/native gzip working memory; it is a JS-heap measurement, not process RSS.

### Exactness

On the real 31-day dataset:

- Legacy text: 60,125,765 chars, SHA-256 `b443eddcb1781aeec19d455f18734da48fc96075607fc0736bd3dc56471e0ebf`.
- Streamed text: identical length and SHA-256.
- Legacy gzip: 21,139,233 bytes, SHA-256 `b8d25e9e…35cf2b`.
- Streamed gzip: identical bytes and SHA-256.
- Streamed gzip decompresses to the exact legacy text.

The synthetic fixture includes non-ASCII histogram labels (`1–9`), two days, null follow-through values, and an empty-map case; all match `JSON.stringify` exactly.

## Implemented optimization 2: workspace restoration

`loadWorkspaceFile()` now:

- Streams the uploaded `.gz` file through `DecompressionStream` instead of `file.arrayBuffer()` plus a `Blob` copy.
- Sets `text = null` immediately after `JSON.parse`.
- Sets `doc = null` after extracting the day objects, before `rebuildCombined()`.

### Browser before/after

| Measurement | Old | New |
|---|---:|---:|
| Load duration | 793 ms | 720 ms |
| Peak polled heap | **351.0 MB** | **345.9 MB** |
| Heap at `JSON.parse` return | **366.7 MB** | **346.5 MB** |
| Heap after load + GC | 144.1 MB | 144.1 MB |
| Allocation total (sampling) | 420.1 MB | 420.9 MB |

The parse-time improvement is mostly from avoiding the compressed-buffer Blob. Releasing `text`/`doc` before rebuild is a reachability improvement; its peak effect depends on when V8 collects, so it is not claimed as a fixed 114 MB saving. The unavoidable `JSON.parse` string/document peak remains.

## Implemented optimization 3: lazy combined 10-second timeframe

### Lifecycle and reference graph

The audit started at import and followed every retained array:

1. `PackedTradeRows` stores one day of prints in a `Float64Array` (four columns per row). It is temporary and released after aggregation.
2. `aggregateDay()` produces the per-day source of truth: `day.bars[tf]` for five timeframes (11 arrays each), `day.profile` (4 arrays), `day.events` (7 arrays), and `day.hist` (a `Float32Array`). These objects are held in `DAYS`.
3. `rebuildCombined()` copies every per-day array into flat combined arrays `B/P/E/HIST`, adding a day offset to timestamps.
4. Charts read the combined arrays through `subsetBars`; `B['1m']` also feeds metrics, KPI, focus, and lead/lag, and `B['1h']` feeds the hour/regime panels.
5. Workspace export serializes `DAYS` (the per-day arrays), so those cannot be dropped. Replacement merges incoming days into `DAYS` and rebuilds the combined arrays.

Because workspace export, date replacement, and partial imports all depend on the per-day arrays, the combined representation cannot be removed. The safe question is which combined series must exist eagerly.

### Measured component cost (Node, after GC)

| Combined component | Retained MB | Bars/items |
|---|---:|---:|
| profile | 11.78 | 331,860 |
| events | 24.79 | 374,692 |
| hist | ~0 (external `Float32Array`) | 401,760 |
| bars 1m | 4.29 | 44,573 |
| bars 5m | 0.83 | 8,916 |
| bars 15m | 0.28 | 2,973 |
| bars 1h | 0.07 | 744 |
| **bars 10s** | **32.44** | **263,735** |
| Total | **74.58** | |

Fresh heap snapshots at `1469e52` reproduced the baseline: **91.64 MB** after import and **166.31 MB** after the combined build. The 10-second series is 77% of the combined bar cost and 43% of the total combined cost, while the default view is 1-minute.

### Ranked options

1. **Build the combined 10-second timeframe lazily — implemented.** Largest single series, unused by the default view, and easy to gate at the two consumers (`subsetBars` and bar export). Expected benefit 32.4 MB retained. Risk low.
2. **Build profile only when the profile panel is visible.** Profile retains 11.78 MB and is not needed for the default price-flow preset. Risk medium: several panels and event calculations read `P`; each would need `ensureProfile()`.
3. **Build events lazily.** Events retain 24.79 MB but feed the default price-chart markers, so they are needed at startup. Lower value unless markers also become lazy.
4. **Typed-array combined columns.** Could reduce per-element overhead, but charts and export expect ordinary arrays with `null` gaps; conversion risk is high for modest gain.
5. **Index per-day arrays directly instead of building combined arrays.** Removes duplication but changes every chart, binary-search, and export consumer. Too risky for this pass.

### Change

`BTCUSD_Market_Mechanics_Lab_Fixed.html` now:

- Defines `EAGER_TIMEFRAMES = ['1m','5m','15m','1h']`; `rebuildCombined()` builds only those.
- Records the combined date order in `COMBINED_DATES`.
- Adds `buildCombinedBars(tf)`, which reproduces the original copy loop for one timeframe.
- Adds `ensureBars(tf)`, which builds and caches a missing timeframe on demand.
- Wraps `subsetBars` and routes `exportSelectedBars` through `ensureBars(tf)`.

`sw.js` cache name is bumped to `btc-mechanics-shell-v20` because the shell HTML changed. The workspace format, per-day arrays, timestamps, day offsets, and the four eager timeframes are untouched.

### Node before/after

| Measurement | Eager all | Lazy 10s |
|---|---:|---:|
| Retained heap after combined build | 133.62 MB | **101.22 MB** |
| Combined retained delta | 41.70 MB | **9.30 MB** |
| Peak RSS during rebuild | 328.4 MB | **275.8 MB** |
| Rebuild duration | 226 ms | **156 ms** |

A repeat run gave 133.64 → 101.24 MB retained, 328.8 → 278.4 MB peak, and 219 → 155 ms. The 10-second arrays were then built in isolation and compared with the eager output: **263,735 bars**, identical in every field, SHA-256 `f75bba2d309b2784c15af0871965ab2435f71e758d39db2c4c1e5a5b4cd59886`.

### Browser before/after

| Measurement | Old (eager) | New (lazy) |
|---|---:|---:|
| Heap after import + GC | **152.5 MB** | **118.8 MB** |
| Heap after selecting 10 seconds | 155.2 MB | 155.0 MB |
| 10-second CSV export | 33,990,238 bytes | 33,990,238 bytes |
| Export SHA-256 | `cf06305d…b7ef1b` | `cf06305d…b7ef1b` |
| Page/console errors | 0 | 0 |

The lazy series costs about **36 MB** the first time 10 seconds is selected; the total then matches the old eager footprint. The saving applies to the default 1-minute view and any session that never opens the 10-second timeframe.

### Full browser workflow

On the real archive with the lazy build:

- First import: 119 MB retained, 31 days, 7,440,458 prints, charts rendered.
- Timeframe cycle `5m → 15m → 1h → 10s → 1m`: every badge and candle count correct, no errors; 10 seconds showed 263,735 source bars.
- First 10-second export: SHA-256 matched the reference.
- Workspace save: 2.1 s, 21,139,243 bytes.
- Reload + restore: 5.1 s, 31 dates, 98.9 MB retained (no 10-second series yet), restored 10-second export matched the reference byte-for-byte.
- Repeated import of the same 31 days: replacement succeeded, 31 days retained, export matched again, heap stayed at ~154 MB because 10 seconds was the active selection.

## Equivalence and regression results

- Real dataset: 31/31 day hashes and 7,440,458 rows match the pre-change reference exactly; **0 diffs**.
- Synthetic edge-case fixture: 3/3 day hashes and 5,003 rows match exactly; **0 diffs**.
- Lazy vs eager combined 10-second bars: identical fields, **263,735 bars**, SHA-256 `f75bba2d…4cd59886`.
- Workspace export: text and gzip byte-identical on all 31 days; the exported 10-second CSV is identical before and after restore and after replacement.
- `node --test tests/importer-regression.test.mjs`: **54/54 pass, 0 fail** (including a new lazy-timeframe source test).
- Browser save/load/import/replacement: no page errors or console errors; 31 dates and 7,440,458 prints restored.
- Offline shell: cache `btc-mechanics-shell-v20`, 19 entries, reload with network offline initializes 9 panel chips and the price-flow preset with no errors.
- Worker checks: results match reference, stale revisions rejected, timeout/fallback/dispose behavior unchanged.
- `node --check` passes for the inline module, `workspace-export.js`, `sw.js`, and the test file.

## Limitations

- Browser heap measurements are page JS heap, not process RSS. Chrome's renderer, GPU process, Blob storage, and native gzip buffers are outside `JSHeapUsedSize`.
- Polling at 10 ms can miss a synchronous peak. The `JSON.parse` hook and stream-enqueue hook reduce that blind spot for the measured moments.
- Allocation sampling counts collected objects; it identifies churn, not live retention.
- Node peak RSS includes V8 heap growth and native gzip/zlib buffers; absolute values differ from the browser.
- The 66 MB input buffer in the snapshot runs inflates snapshot totals; snapshot deltas, not totals, are used for attribution.
- Physical Samsung Galaxy A35 testing remains outstanding.
- The lazy 10-second series is rebuilt after every import or workspace restore; a session that keeps 10 seconds selected pays the same ~36 MB as before. The saving is specifically for sessions that use the default or other eager timeframes.
- The first 10-second selection adds about 86–105 ms in Node (a similar one-time cost in the browser) while the series is built. This is a latency-for-memory trade, not a free reduction.
- Profile (11.78 MB) and events (24.79 MB) remain eager. Events feed the default price-chart markers; profile laziness would need an `ensureProfile()` at every consumer.

## Files changed

- `src/app/workspace-export.js` — new streaming JSON exporter and legacy text fallback.
- `BTCUSD_Market_Mechanics_Lab_Fixed.html` — imports the exporter; streaming save; streaming gzip load; releases text/document before rebuild; lazy combined 10-second timeframe with `EAGER_TIMEFRAMES`, `buildCombinedBars()`, `ensureBars()`, and wrapped `subsetBars`.
- `sw.js` — precaches `workspace-export.js`; cache bumped to `btc-mechanics-shell-v20`.
- `tests/importer-regression.test.mjs` — workspace-export tests, source/cache assertions, and a lazy-timeframe source test (51 → 54 tests).
- `README.md` — memory-validation results and module/test-count updates.
- `Memory_Profile_Report.md` — this report.
