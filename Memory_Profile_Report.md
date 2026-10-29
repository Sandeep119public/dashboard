# Memory profile and workspace-export optimization

## Scope

- Commit measured: `c144be2890fcc4780c1d284094acdbec1a3f1234` (`c144be2`, the deployed revision).
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
3. **Eliminate per-day/combined duplication — not implemented.** About **70 MB** of retained array storage is duplicated because `rebuildCombined()` copies every per-day bar/profile/event array into flat combined arrays. The per-day copies are required for workspace export, date replacement, and partial imports, so removing them needs a lifecycle audit or a chunked/typed-array view. Impact: high; risk: high.
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

## Equivalence and regression results

- Real dataset: 31/31 day hashes and 7,440,458 rows match the pre-change reference exactly; **0 diffs**.
- Synthetic edge-case fixture: 3/3 day hashes and 5,003 rows match exactly; **0 diffs**.
- Workspace export: text and gzip byte-identical on all 31 days.
- `node --test tests/importer-regression.test.mjs`: **53/53 pass, 0 fail**.
- Browser save/load/import: no page errors or console errors; 31 dates and 7,440,458 prints restored.
- Offline shell: cache `btc-mechanics-shell-v19`, 19 entries, reload with network offline initializes 9 panel chips and the price-flow preset with no errors.
- Worker checks: results match reference, stale revisions rejected, timeout/fallback/dispose behavior unchanged.
- `node --check` passes for the inline module, `workspace-export.js`, `sw.js`, and the test file.

## Limitations

- Browser heap measurements are page JS heap, not process RSS. Chrome's renderer, GPU process, Blob storage, and native gzip buffers are outside `JSHeapUsedSize`.
- Polling at 10 ms can miss a synchronous peak. The `JSON.parse` hook and stream-enqueue hook reduce that blind spot for the measured moments.
- Allocation sampling counts collected objects; it identifies churn, not live retention.
- Node peak RSS includes V8 heap growth and native gzip/zlib buffers; absolute values differ from the browser.
- The 66 MB input buffer in the snapshot runs inflates snapshot totals; snapshot deltas, not totals, are used for attribution.
- Physical Samsung Galaxy A35 testing remains outstanding.
- The largest retained opportunity, the ~70 MB per-day/combined duplication, was deliberately not changed because its consumers and lifecycle have not been fully audited.

## Files changed

- `src/app/workspace-export.js` — new streaming JSON exporter and legacy text fallback.
- `BTCUSD_Market_Mechanics_Lab_Fixed.html` — imports the exporter; streaming save; streaming gzip load; releases text/document before rebuild.
- `sw.js` — precaches `workspace-export.js`; cache bumped to `btc-mechanics-shell-v19`.
- `tests/importer-regression.test.mjs` — 2 new workspace-export tests plus source/cache assertions (51 → 53 tests).
- `README.md` — memory-validation results and module/test-count updates.
- `Memory_Profile_Report.md` — this report.
