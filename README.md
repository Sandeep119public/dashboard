# BTCUSD Market Mechanics Lab

Interactive trade-flow research dashboard for BTCUSD price action, executed volume, signed flow, cumulative volume delta, volume-at-price, large-trade follow-through and lead/lag studies.

## Open the dashboard

Serve this folder over HTTP; do not open the HTML directly from disk. Browsers block ES modules and Web Workers on `file://`, so the app shows a warning instead of starting. From the repository root:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/BTCUSD_Market_Mechanics_Lab_Fixed.html> (or the repository root, which redirects to that page). `npx serve .` works too. The GitHub Pages copy loads Plotly from its official CDN, so an internet connection is required for a first load; the service worker caches the app shell and Plotly for offline reloads after that.

## Single-screen workstation

The page is laid out as one viewport-height workstation with a compact header, a single chart picker on desktop and mobile, three grouped metric cards (performance, activity and order flow), one flexible chart stage, and a compact replay footer. Each metric card pairs a headline value with its related context, keeping all six window metrics available without six separate tiles. Only the active chart is displayed; the other eight keep their rendered state and are shown on demand. Bar-level replay metrics and diagnostics sit under **Bar details** and stay out of the way until needed. Imports, filters, exports, workspace save/restore, chart settings and data notes live in the **Filters & tools** drawer.

The chart stage uses `display:contents` grids and a flexing Plotly container with `autosize`, so tab switches and viewport changes resize the active plot instead of leaving a blank or fixed-height canvas. Each chart tracks a dirty flag: switching to a chart that is already rendered only resizes it and re-applies the linked cursor, while a full refresh marks every chart dirty and renders only the active one.

### Mobile and accessibility

The header actions, chart picker and drawer controls use touch-sized targets on phones, with safe-area padding for notches and gesture bars. Replay transport and scrubber controls remain compact to preserve chart height. The native chart picker is keyboard accessible; `[` and `]` also cycle charts. Escape closes the drawer first, then restores a maximized panel and stops replay. Focus outlines, dark native form controls, reduced-motion handling and a no-horizontal-scroll layout are preserved.

Chromium emulation was checked at 360×800, 390×844, 412×915, 768×1024, 1280×720, 1920×1080, and landscape 800×360, 844×390 and 915×412. Every viewport had `scrollWidth === innerWidth`, no clipped header actions, a visible Plotly canvas, and the replay footer inside the viewport. A physical Samsung Galaxy A35 run is still outstanding, so on-device performance and touch feel are not certified.

## Live Market workspace (new)

The **Live market** chart tab adds a separate public Binance COIN-M BTCUSD perpetual workspace. It does not replace or alter the imported-archive research panels.

- **Historical and live exchange candles:** native COIN-M klines for 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w and 1M. The desk loads the latest 500 candles on connect and follows the selected live kline stream.
- **Seconds candles:** 1s, 5s, 10s, 15s and 30s are trade-built from aggregate executions observed after connection. Binance's COIN-M kline endpoint starts at one minute; seconds history is not fabricated. Imported 10-second archive bars can be displayed when a compatible local archive has been loaded.
- **Executed trades:** the public aggregate-trade stream identifies whether the buyer was maker. buyer is maker = false means BUY TAKER / SELL MAKER; buyer is maker = true means SELL TAKER / BUY MAKER. One execution quantity is mirrored to the two sides, not added twice. Live stats and the tape reset when the live connection starts.
- **Volume bars:** the market desk shows buy-taker quantity above zero and sell-taker quantity below zero. COIN-M contract quantity is retained as reported by Binance; it is not relabelled as BTC or USD notional.
- **Resting liquidity:** a REST depth snapshot is joined to buffered WebSocket depth diffs using the update sequence. The book is shown as synced only after the first event bridges the snapshot; subsequent pu discontinuities trigger a fresh snapshot. Best bid/ask, spread and the top 14 levels on each side are displayed.
- **Depth caveats:** the public book is aggregated by price level, not individual maker order ID. A reduction in displayed quantity can be an execution or cancellation; the public depth diff alone does not label which. This live feed does not provide historical order-book replay or queue position.
- **Source and privacy:** this feature connects the browser directly to Binance's public COIN-M REST and market WebSocket endpoints. It does not require an API key or upload your imported archive. Internet access is required while connected. Disconnect pauses live updates but leaves the latest candles visible.

The live desk is intentionally a separate chart tab. The original CSV/ZIP importer, offline archive analysis, existing price/flow/CVD/profile/research charts, linked replay and workspace export/restore remain available. The service worker caches the two new market modules for the app shell; public market data itself is never cached as a substitute for a live connection.

## Import data

Use **Import** (header or the empty state) to import data. The importer supports Binance-style BTCUSD, BTCUSDT and BTCUSD_PERP CSV files, including a monthly ZIP containing one chronologically sorted CSV across multiple dates, and multiple CSV/ZIP files in one selection.

Supported layouts:

- Canonical header `product_symbol,price,size,timestamp,buyer_role`, in any column order.
- Column aliases: `qty`/`quantity` for size, `time`/`transact_time`/`trade_time` for timestamp, `side` for buyer role, and `symbol`/`product` for the product.
- Headerless files with 4 or 5 columns. The parser locates the ISO timestamp, the maker/taker (or sell/buy) role and an optional BTC symbol, then uses the first two remaining positive numeric columns as price and size.
- Repeated header blocks in concatenated daily exports are skipped instead of being parsed as trades.
- `buy`/`sell` role values are accepted as aliases for `taker`/`maker`.

Rows with missing fields, non-positive prices/sizes, unknown roles, invalid calendar timestamps, mixed symbols, or non-contiguous dates are rejected with the row number rather than silently classified. A failed or cancelled import leaves the previously loaded dates untouched, and re-importing the same dates replaces them instead of double-counting. Progress reports both processed rows and streamed bytes; cancellation is checked at every 25,000-row boundary.

Large ZIPs are streamed directly from the archive. The app reads the ZIP directory and decompresses the CSV incrementally, validates records, aggregates one day at a time, and reports progress. It does not keep the entire expanded CSV in one giant string. During aggregation, the active day's raw trades use a packed four-column numeric buffer rather than one JavaScript array object per trade, reducing intermediate object overhead for large imports.

The importer was validated against `futures-trades-monthly-BTCUSD-2026-08.csv.zip`: 7,440,458 trade prints across August 1–31, 2026, matching an independent CSV row count. ZIP central-directory offsets and entry lengths are checked before streaming; EOCD comment lengths, local filenames, and compressed-payload bounds are also validated. For ZIP64 archives or unsupported compression, extract the CSV and import it directly. Use current Chrome or Edge for streaming ZIP decompression. Run `npm test` (or `node --test tests`) to check ZIP parsing, malformed archives and the data-integrity suite; GitHub Actions runs all tests on relevant pushes and pull requests.

## Performance validation

The import hot path was optimized without changing outputs. On Node 20 with the August archive, a full parse plus daily aggregation fell from **16.58 s to 7.7 s** (about 53% faster); peak RSS was 409 MB before and 398–408 MB after across runs, including the 66 MB compressed input, so the change is a speed improvement rather than a peak-memory reduction. Per-day output was compared against the previous parser and aggregator using SHA-256 over every metric, bar, profile, histogram and event array: all 31 days and 7,440,458 rows matched exactly, as did a 5,003-row synthetic fixture covering CRLF, quoted fields, mixed case, duplicate seconds, missing minutes and fractional timestamps.

### Workstation hardening benchmark (2026-11-01)

The parser additions were benchmarked against the previous parser on the same generated 500,000-row canonical CSV with one-minute aggregation. Four alternating runs produced 305–320 ms for the previous parser and 327–340 ms for the hardened parser, about **6–7% slower on the mean** for the extra header/symbol/role validation, or roughly **1.5 million rows/s**. Outputs were identical on every run (1,440 bars, total executed size 2,499,990, same per-day metrics). Memory was the same or slightly lower (about 249 MB vs 253 MB retained heap in the last pair of runs).

In Chromium at 1280×720, the deterministic three-day monthly ZIP (25,920 prints) imported in **112–121 ms**. Switching to a chart that had not been rendered yet took about **90–120 ms** (flow took about 224 ms on its first render); switching back to any already-rendered chart made **zero `Plotly.react` calls** and only resized the canvas. The active-chart-only refresh removes the previous behavior where every tab switch rebuilt all timeframes.

## Memory validation

A separate memory profile of the same August archive separated temporary allocation spikes from retained data. On Node 20 with a file-backed input, retained JS heap was **92 MB after import** and **166.6 MB after the combined multi-timeframe arrays were built**. Heap snapshots showed the combined arrays duplicate about **70.4 MB** of per-day array storage, and `JSON.stringify` of the workspace added a **114.5 MB** two-byte string (57.3 M characters). Chrome 156 at 1366×900 retained **152.5 MB** after import while the import phase peaked near **267.8 MB** and allocated about **1.85 GB** in total, mostly inside `aggregateDay` and `parseCsvStreamByDay`.

Workspace export now streams one day at a time into gzip instead of building the whole JSON string and copying it into a Blob. With identical input and gzip implementation, Node peak RSS fell from **505.6–540.2 MB to 286.2–296.5 MB** across three runs, and the browser's sampled live heap fell from **275.1 MB to 213.2 MB**. The downloaded workspace remained byte-identical (20.2 MB gzip, SHA-256 `b8d25e9e…35cf2b`), and save time stayed at about **2.7 s**. Workspace load now streams gzip from the file and releases the JSON text/document before rebuilding; browser load peak fell from **351.0 MB to 345.9 MB**, with the JSON-parse moment falling from **366.7 MB to 346.5 MB**. These are browser JS-heap measurements; Chrome is multi-process, so they are not process RSS. A physical Samsung Galaxy A35 run remains outstanding.

A follow-up audit of the ~70 MB per-day/combined duplication measured each combined series separately. The combined **10-second** timeframe alone retained **32.4 MB** on the August archive and is not used by the default 1-minute view, so it is now built lazily on first use (`EAGER_TIMEFRAMES` keeps `1m/5m/15m/1h` eager). Node retained heap after the combined build fell from **133.6 MB to 101.2 MB** and rebuild peak RSS from **328.4 MB to 275.8 MB**; the browser dropped from **152.5 MB to 118.8 MB** after import. Selecting 10 seconds builds the series once (about **86–105 ms**, raising the browser to ~155 MB, the same total as before), and the lazily built bars are byte-identical to the eager build: 263,735 bars with SHA-256 `f75bba2d…4cd59886`, and an identical 33,990,238-byte CSV export (SHA-256 `cf06305d…b7ef1b`). Workspace format, day boundaries, and all four eager timeframes are unchanged. Repeated imports, workspace save/restore, offline loading, and the lead/lag worker were re-verified; the suite now has **75 passing tests**.

The lead/lag engine now keeps windows of 4,000 or fewer one-minute bars on the main thread and sends larger windows to a module worker, avoiding structured-clone round trips when they cost more than the calculation. A worker request has a 5-second timeout; failures, stale revisions and message errors fall back to the same tested calculator on the main thread. The engine recreates a failed worker on the next data revision (up to three consecutive failures) and `dispose()` terminates it. The lead/lag caption reports whether the last result came from the worker or the main thread.

## Code structure

The browser app keeps its existing single-page UI but separates reusable logic into native ES modules: `src/app/import-controller.js` coordinates CSV/ZIP imports and progress callbacks, `src/app/workspace-export.js` streams workspace JSON one day at a time for gzip export, `src/ingestion/zip-reader.js` owns ZIP directory validation and CSV-entry streaming, `src/ui/mobile-quick-actions.js` wires the mobile import/chart/replay/filter shortcuts through injected dependencies, and `src/charts/latest-render-queue.js` serializes chart updates while retaining only the latest pending request per chart. `src/charts/bar-subsetter.js` selects time windows and downsamples large chart ranges while preserving OHLCV sums, gaps, and session boundaries. `src/charts/series-math.js` contains gap-aware rolling imbalance, line-gap generation, EMA calculation, and daily-reset trade-weighted price calculations. It also provides the median and Pearson correlation helpers used by event follow-through and flow lead-lag panels. The flow lead-lag panel runs through `src/charts/lead-lag-engine.js`, which uses `src/charts/lead-lag.worker.js` when module workers are available and falls back to the same tested calculator on the main thread otherwise. The data layer is split across `src/data/packed-trade-rows.js` and `src/data/day-aggregator.js` for packed trade storage and daily OHLCV, profiles, histograms, metrics, and large-trade follow-through events. The page imports these modules explicitly, and the service worker precaches them for offline use. The 75 Node regression tests cover importer behavior, malformed CSV and ZIP cases, CRLF/quoted/fractional-second parsing, headerless and aliased columns, accepted symbols, repeated header blocks, byte progress, cancellation, duplicate/out-of-order timestamps, midnight and month boundaries, missing intervals, OHLC/CVD/profile/histogram/event integrity, workspace view round-trips, mobile action routing, latest-wins chart scheduling, bar-window selection/downsampling, cache invalidation, lazy combined-timeframe construction, gap-aware series calculations, EMA resets, price-weighted averages, median and Pearson statistics, worker-backed lead/lag calculations, worker timeouts, stale revisions, failure recovery, adaptive dispatch, disposal, and checks that local JavaScript imports and worker scripts resolve and are included in the offline shell. Chart-specific calculations and the broader UI state remain in the main page, so this is an incremental refactor rather than a full rewrite.

## UI update behavior

The workstation renders one active chart at a time. A full refresh (date/time range, interval, import) marks all nine charts dirty but renders only the active one; switching to another chart renders just that chart if it is stale, otherwise it only resizes the canvas and re-applies the linked cursor. Chart controls refresh only the panels that depend on them: the large-print threshold redraws the price and large-trade charts, profile binning redraws the volume profile, smoothing redraws flow, and the lead/lag lookback redraws only that research panel. Replay cursor updates are throttled rather than debounced, so a fast replay keeps advancing, and non-time charts are skipped.

This was verified in Chromium against a deterministic three-day archive: all nine charts rendered after import, cached tab switches made zero `Plotly.react` calls, only one chart card was visible at a time, keyboard tab navigation and `[`/`]` cycling worked, the drawer opened/closed with Escape, and the active chart plus replay footer stayed inside the viewport at every tested size. Intraday 09:00–10:00 filtering updated the KPI strip to 17,646 prints without changing the loaded data.

## Accuracy notes

Directional flow depends on the source buyer-role field. The source does not explicitly specify timestamp timezone or trade-size unit. Trade prints do not include order-book snapshots, so resting liquidity, queue position and cancellations cannot be directly measured. Correlations and post-trade outcomes are descriptive research, not proof of predictive trading edge.

See [BTCUSD_Market_Mechanics_Fix_Report.md](BTCUSD_Market_Mechanics_Fix_Report.md) for audit notes and remaining limitations.
