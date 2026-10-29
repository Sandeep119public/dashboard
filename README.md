# BTCUSD Market Mechanics Lab

Interactive trade-flow research dashboard for BTCUSD price action, executed volume, signed flow, cumulative volume delta, volume-at-price, large-trade follow-through and lead/lag studies.

## Open the dashboard

Serve this folder over HTTP; do not open the HTML directly from disk. Browsers block ES modules and Web Workers on `file://`, so the app shows a warning instead of starting. From the repository root:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/BTCUSD_Market_Mechanics_Lab_Fixed.html> (or the repository root, which redirects to that page). `npx serve .` works too. The GitHub Pages copy loads Plotly from its official CDN, so an internet connection is required for a first load; the service worker caches the app shell and Plotly for offline reloads after that.

## Mobile and accessibility

The dashboard includes responsive chart layouts, a compact mobile action bar, safe-area-aware spacing for phones, keyboard-visible focus outlines, dark native form controls, and support for users who prefer reduced motion or higher contrast. Key mobile controls are at least 44 CSS pixels high, including replay buttons, speed/scrubber controls, panel actions and checkboxes. The 360×780 CSS-pixel Android layout was checked in Chromium emulation with no horizontal overflow; a physical Samsung Galaxy A35 run is still outstanding, so test on-device before treating mobile performance as certified.

## Import data

Use **Add trade files (.CSV / .ZIP)** to import data. The importer supports Binance-style BTCUSD CSV files with columns `product_symbol,price,size,timestamp,buyer_role`, including a monthly ZIP containing one chronologically sorted CSV across multiple dates.

Large ZIPs are streamed directly from the archive. The app reads the ZIP directory and decompresses the CSV incrementally, validates records, aggregates one day at a time, and reports progress. It does not keep the entire expanded CSV in one giant string. During aggregation, the active day's raw trades use a packed four-column numeric buffer rather than one JavaScript array object per trade, reducing intermediate object overhead for large imports.

The importer was validated against `futures-trades-monthly-BTCUSD-2026-08.csv.zip`: 7,440,458 trade prints across August 1–31, 2026, matching an independent CSV row count. ZIP central-directory offsets and entry lengths are checked before streaming; EOCD comment lengths, local filenames, and compressed-payload bounds are also validated. For ZIP64 archives or unsupported compression, extract the CSV and import it directly. Use current Chrome or Edge for streaming ZIP decompression. Run `node --test tests/importer-regression.test.mjs` to check ZIP parsing and malformed-archive handling; GitHub Actions runs this test on relevant pushes and pull requests.

## Performance validation

The import hot path was optimized without changing outputs. On Node 20 with the August archive, a full parse plus daily aggregation fell from **16.58 s to 7.7 s** (about 53% faster); peak RSS was 409 MB before and 398–408 MB after across runs, including the 66 MB compressed input, so the change is a speed improvement rather than a peak-memory reduction. Per-day output was compared against the previous parser and aggregator using SHA-256 over every metric, bar, profile, histogram and event array: all 31 days and 7,440,458 rows matched exactly, as did a 5,003-row synthetic fixture covering CRLF, quoted fields, mixed case, duplicate seconds, missing minutes and fractional timestamps.

The lead/lag engine now keeps windows of 4,000 or fewer one-minute bars on the main thread and sends larger windows to a module worker, avoiding structured-clone round trips when they cost more than the calculation. A worker request has a 5-second timeout; failures, stale revisions and message errors fall back to the same tested calculator on the main thread. The engine recreates a failed worker on the next data revision (up to three consecutive failures) and `dispose()` terminates it. The lead/lag caption reports whether the last result came from the worker or the main thread.

## Code structure

The browser app keeps its existing single-page UI but separates reusable logic into native ES modules: `src/app/import-controller.js` coordinates CSV/ZIP imports and progress callbacks, `src/ingestion/zip-reader.js` owns ZIP directory validation and CSV-entry streaming, `src/ui/mobile-quick-actions.js` wires the mobile import/chart/replay/filter shortcuts through injected dependencies, and `src/charts/latest-render-queue.js` serializes chart updates while retaining only the latest pending request per chart. `src/charts/bar-subsetter.js` selects time windows and downsamples large chart ranges while preserving OHLCV sums, gaps, and session boundaries. `src/charts/series-math.js` contains gap-aware rolling imbalance, line-gap generation, EMA calculation, and daily-reset trade-weighted price calculations. It also provides the median and Pearson correlation helpers used by event follow-through and flow lead-lag panels. The flow lead-lag panel runs through `src/charts/lead-lag-engine.js`, which uses `src/charts/lead-lag.worker.js` when module workers are available and falls back to the same tested calculator on the main thread otherwise. The data layer is split across `src/data/packed-trade-rows.js` and `src/data/day-aggregator.js` for packed trade storage and daily OHLCV, profiles, histograms, metrics, and large-trade follow-through events. The page imports these modules explicitly, and the service worker precaches them for offline use. The 51 Node regression tests cover importer behavior, malformed CSV and ZIP cases, CRLF/quoted/fractional-second parsing, mobile action routing, latest-wins chart scheduling, bar-window selection/downsampling, cache invalidation, gap-aware series calculations, EMA resets, price-weighted averages, median and Pearson statistics, worker-backed lead/lag calculations, worker timeouts, stale revisions, failure recovery, adaptive dispatch, disposal, and checks that local JavaScript imports and worker scripts resolve and are included in the offline shell. Chart-specific calculations and the broader UI state remain in the main page, so this is an incremental refactor rather than a full rewrite.

## UI update behavior

Chart controls refresh only the panels that depend on them: the large-print threshold redraws the price and large-trade charts, profile binning redraws the volume profile, smoothing redraws flow, and the lead/lag lookback redraws only that research panel. Showing a panel renders that panel only; a full-lab switch still renders every visible panel. Replay cursor updates are throttled rather than debounced, so a fast replay keeps advancing, and hidden charts are skipped. This was verified in Chromium against the full August archive: a threshold change rendered two charts instead of all nine, a lookback change rendered one, and 12× replay applied 84 cursor relayouts in four seconds.

## Accuracy notes

Directional flow depends on the source buyer-role field. The source does not explicitly specify timestamp timezone or trade-size unit. Trade prints do not include order-book snapshots, so resting liquidity, queue position and cancellations cannot be directly measured. Correlations and post-trade outcomes are descriptive research, not proof of predictive trading edge.

See [BTCUSD_Market_Mechanics_Fix_Report.md](BTCUSD_Market_Mechanics_Fix_Report.md) for audit notes and remaining limitations.
