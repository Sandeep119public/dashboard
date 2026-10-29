# BTCUSD Market Mechanics Lab: Fix Report

This report accompanies the fixed standalone dashboard. It summarizes corrected metric definitions and validation performed locally.

## Corrections

- Tightened forward-horizon measurements so events are evaluated against bounded target times instead of unbounded bar offsets.
- Undefined correlations are represented as unavailable when there are insufficient samples or zero variance.
- Removed averaging across daily medians as a proxy for a pooled median.
- Improved compressed chart aggregation to preserve price-times-size sums and added those sums to bar CSV exports.
- Clarified approximate VWAP behavior for older saved workspaces and replay instructions.
- Added checks against invalid values in imported records.

## Validation notes

- Original embedded trade archive: 314,107 records for 2026-09-01.
- JavaScript syntax and dashboard initialization checks passed in the local runtime harness.
- OHLC and size totals were tested across chart timeframes and synthetic multi-day fixtures.
- The 15,732 embedded large-trade events were checked against the revised horizon bounds.

## Remaining source-data limitations

The dataset does not establish the exact buyer-role semantic without a source schema, the timezone is not encoded in every timestamp, and the size field's contract multiplier/unit is not confirmed. There are no order-book updates, so resting liquidity, cancellations, spread dynamics and queue position cannot be directly observed. The embedded data includes September 1, 2026 only; users must import additional daily files for multi-day analysis.

Statistical association between contemporaneous signed flow and returns is descriptive and should not be interpreted as predictive trading edge without out-of-sample validation.


## Monthly ZIP validation

Added streaming ZIP and CSV parsing for large monthly archives. The importer reads the ZIP end-of-central-directory and entry metadata without copying the entire archive into memory, streams DEFLATE decompression, parses rows incrementally, and aggregates each UTC-normalized date as it reaches the day boundary. The common unquoted CSV line is parsed through a fast native split path; quoted rows retain the quote-aware parser. Progress updates are shown throughout.

Validation with the August sample archive:
- Compressed ZIP: 66,245,295 bytes.
- CSV member: 391,774,302 uncompressed bytes.
- Trade rows (excluding header): 7,440,458.
- Dates: 2026-08-01 through 2026-08-31, all 31 calendar days.
- First day: 114,708 rows.
- Last day: 291,474 rows.
- Import completed in about 48 seconds in the deterministic Node/Web Streams runtime test, with observed RSS around 555 MB at peak. Browser speed and peak memory vary by device.
- After import, the dashboard reported 31 loaded days and 7,440,458 trade prints.

This validates the streaming parser against the supplied archive and row counts. A full browser visual regression was not performed in this environment. The app still cannot infer unprovided order-book data, timestamp timezone semantics, or the exact contract multiplier.


## Import memory refinement (2026-10-28)

The daily aggregation path now stores transient trade records in a packed four-column `Float64Array` buffer and sorts packed records only when timestamps arrive out of order. This preserves numeric precision and the existing event/bar calculations while reducing per-trade JavaScript object overhead. The change has been source-reviewed, but a full browser/device memory benchmark and visual regression were not performed in this environment; the previously reported 555 MB peak belongs to the earlier Node test and should not be treated as the new peak-memory measurement.


## ZIP parser hardening (2026-10-28)

- The end-of-central-directory scan now checks the declared ZIP comment length, avoiding false matches on a ZIP-signature byte sequence embedded in a valid comment.
- Each CSV entry's local filename must match its central-directory filename.
- Compressed payloads must remain before the central directory and within the uploaded file, preventing malformed offsets from reading directory bytes as CSV data.
- Added regression cases for valid comments containing a false ZIP signature, stored-entry streaming, local filename mismatches, and directory/payload bounds.


## Separation of concerns and modularity (2026-10-28)

- Extracted ZIP directory validation and entry streaming into `src/ingestion/zip-reader.js`, a standalone ES module with no UI dependencies.
- Extracted `PackedTradeRows` into `src/data/packed-trade-rows.js`, allowing direct unit tests and reuse by future data-processing workers.
- Switched the main dashboard script to a native ES module and exposed the embedded initial data as `window.DATA` to bridge the existing inline data bootstrap safely.
- Bumped the service-worker shell cache and precached both modules for offline app-shell loading.
- Updated regression tests to import the production modules directly instead of extracting function/class source strings from the HTML.
- This is the first modularization slice; orchestration, aggregation, chart rendering, and UI state remain in the main HTML pending separate tested extractions.

- Extracted day-level OHLCV/profile/metrics/event aggregation into `src/data/day-aggregator.js`; the module accepts bar-step and histogram-label configuration and has a focused OHLCV/signed-flow regression test.


## CSV parser extraction (2026-10-29)

- Moved CSV row parsing, timestamp validation/UTC normalization, BTCUSD schema checks, per-day buffering, and incremental stream processing into `src/ingestion/csv-parser.js`.
- Injected cancellation and aggregation configuration rather than reading DOM or global import state from the parser module.
- Wired the existing import flow to the module and added regression coverage for timezone offsets, invalid dates, schema/role/symbol validation, daily OHLCV and signed flow, and stream chunk boundaries.
- Updated the service-worker cache version and precached the parser module for offline app-shell use.


## Import controller extraction (2026-10-29)

- Moved CSV/ZIP file iteration, ZIP-entry streaming coordination, per-batch duplicate-date checks, cancellation checks, and progress events into `src/app/import-controller.js`.
- Kept UI rendering and final commit of successfully imported days in the page, passing cancellation, progress, bar-step, and histogram settings into the controller.
- Added tests for standalone CSV imports, progress callbacks, duplicate-date rejection, and cancellation before parsing.
- Bumped the service-worker shell cache and precached the controller module for offline use.

## UI controller and chart queue extraction (2026-10-29)

- Extracted mobile import/chart/replay/filter shortcuts into `src/ui/mobile-quick-actions.js`. The module receives its browser elements and dashboard actions through arguments, allowing the routing behavior to be tested under Node without DOM globals.
- Extracted per-chart rendering coordination into `src/charts/latest-render-queue.js`. In-flight renders are serialized and repeated pending refreshes collapse to the latest request for that chart.
- Added regression tests for the mobile shortcuts, listener disposal, latest-wins queue behavior, render-error recovery, and local-module/offline-shell consistency.
- Updated the service-worker shell cache to include both modules and advanced the cache version to `btc-mechanics-shell-v12`.
- These are source-level regression tests, not a substitute for visual regression on desktop browsers or physical Android device testing.

## Chart windowing and downsampling extraction (2026-10-29)

- Extracted time-range selection, bounded subset caching, gap segmentation, and OHLCV downsampling into `src/charts/bar-subsetter.js`.
- The subsetter receives the combined bar series through a getter, so it follows imports that rebuild the aggregate data; the page explicitly clears its cache after rebuilding.
- Added synthetic regression fixtures for inclusive time windows, cache invalidation, volume/trade/delta/price-volume preservation during downsampling, missing-data gaps, UTC midnight boundaries, and cache-size limits.
- Added the new module to the service-worker shell and advanced its cache version to `btc-mechanics-shell-v13`.
- These unit tests guard the data transformation logic. They are not a substitute for browser visual regression or testing on a physical Android device.

## Chart series math extraction (2026-10-29)

- Moved rolling imbalance, gap-separating line-array generation, EMA, and trade-weighted price calculations into `src/charts/series-math.js`.
- The series module has no DOM or Plotly dependency; the page injects its epoch-millisecond timestamp converter.
- Added six regression tests for rolling-ratio gap resets, compressed group endpoint mapping, null line breaks, EMA warm-up and gap resets, daily trade-weighted price resets, legacy HLC3 fallback labeling, and invalid arguments.
- Added the module to the service-worker app shell and advanced its cache version to `btc-mechanics-shell-v14`.
- This validates calculation contracts under Node. Browser visual regression and physical Android performance tests remain outstanding.

## Chart statistics extraction update (2026-10-29)

- Moved median aggregation for large-trade follow-through and Pearson correlation used by the flow lead-lag view into `src/charts/series-math.js`.
- Added regression checks for odd/even medians, missing observations, perfect positive/negative correlations, zero variance, and insufficient samples.
- Advanced the service-worker shell cache to `btc-mechanics-shell-v15` so installed clients can refresh the modified calculation module.

## Worker-backed flow lead/lag analysis (2026-10-29)

- Added `src/charts/lead-lag.js`, a reusable calculator that maintains prefix sums for the loaded one-minute data and recomputes correlations for selected ranges/lookbacks.
- Added `src/charts/lead-lag.worker.js` and `src/charts/lead-lag-engine.js`; the dedicated module worker receives the one-minute arrays once per combined-data revision, then accepts compact range/lookback requests.
- Switched the dashboard's lead/lag panel to the worker engine. If module workers are unavailable or fail, the engine routes pending work through the same calculator on the main thread.
- Added regression coverage for exact minute horizons, missing-minute gaps, main-thread results, worker protocol, and worker-failure fallback.
- Bumped the service-worker app-shell cache to `btc-mechanics-shell-v16` and included all worker dependencies in the offline shell.
- Node regression tests pass for this code path; browser-level worker behavior and performance have not yet been measured on a physical Android device. The worker uses structured cloning for one-time series transfer per data rebuild, so the benefit for small datasets may be limited.
