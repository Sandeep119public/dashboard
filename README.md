# BTCUSD Market Mechanics Lab

Interactive trade-flow research dashboard for BTCUSD price action, executed volume, signed flow, cumulative volume delta, volume-at-price, large-trade follow-through and lead/lag studies.

## Open the dashboard

Open [BTCUSD_Market_Mechanics_Lab_Fixed.html](BTCUSD_Market_Mechanics_Lab_Fixed.html) in a modern browser. The GitHub Pages copy loads Plotly from its official CDN, so an internet connection is required.

## Import data

Use **Add trade files (.CSV / .ZIP)** to import data. The importer supports Binance-style BTCUSD CSV files with columns `product_symbol,price,size,timestamp,buyer_role`, including a monthly ZIP containing one chronologically sorted CSV across multiple dates.

Large ZIPs are streamed directly from the archive. The app reads the ZIP directory and decompresses the CSV incrementally, validates records, aggregates one day at a time, and reports progress. It does not keep the entire expanded CSV in one giant string. During aggregation, the active day's raw trades use a packed four-column numeric buffer rather than one JavaScript array object per trade, reducing intermediate object overhead for large imports.

The importer was validated against `futures-trades-monthly-BTCUSD-2026-08.csv.zip`: 7,440,458 trade prints across August 1–31, 2026, matching an independent CSV row count. ZIP central-directory offsets and entry lengths are checked before streaming; EOCD comment lengths, local filenames, and compressed-payload bounds are also validated. For ZIP64 archives or unsupported compression, extract the CSV and import it directly. Use current Chrome or Edge for streaming ZIP decompression. Run `node --test tests/importer-regression.test.mjs` to check ZIP parsing and malformed-archive handling; GitHub Actions runs this test on relevant pushes and pull requests.

## Code structure

The browser app keeps its existing single-page UI but separates reusable logic into native ES modules: `src/app/import-controller.js` coordinates CSV/ZIP imports and progress callbacks without DOM dependencies, `src/ingestion/zip-reader.js` owns ZIP directory validation and CSV-entry streaming, while `src/data/packed-trade-rows.js` owns the packed four-column trade buffer and `src/data/day-aggregator.js` builds daily OHLCV, profiles, histograms, metrics, and large-trade follow-through events. The page imports these modules explicitly, and the service worker precaches them for offline use. Day aggregation, chart rendering, and UI state remain in the main page or data modules as appropriate, so this is an incremental refactor rather than a full rewrite.

## Accuracy notes

Directional flow depends on the source buyer-role field. The source does not explicitly specify timestamp timezone or trade-size unit. Trade prints do not include order-book snapshots, so resting liquidity, queue position and cancellations cannot be directly measured. Correlations and post-trade outcomes are descriptive research, not proof of predictive trading edge.

See [BTCUSD_Market_Mechanics_Fix_Report.md](BTCUSD_Market_Mechanics_Fix_Report.md) for audit notes and remaining limitations.
