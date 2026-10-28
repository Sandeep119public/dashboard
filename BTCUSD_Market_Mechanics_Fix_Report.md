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
