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
