# BTCUSD Market Mechanics Lab

Interactive trade-flow research dashboard for BTCUSD price action, executed volume, signed flow, cumulative volume delta, volume-at-price, large-trade follow-through and lead/lag studies.

## Open the dashboard

Open `BTCUSD_Market_Mechanics_Lab_Fixed.html` in a modern browser. The repository copy is a lightweight web version: it loads Plotly from the official CDN, so an internet connection is required. It starts with an empty dataset. Choose **Import trade data** and select your Binance daily CSV or ZIP archive to populate the charts. Use multiple files for multi-day analysis.

The original archive available in the conversation contains trades for September 1, 2026 only. Add more daily files to analyze additional sessions.

## Accuracy notes

The dashboard's directional flow depends on the source buyer-role field. The source does not explicitly specify timestamp timezone or trade-size unit. Trade prints do not include order-book snapshots, so resting liquidity, queue position and cancellations cannot be directly measured. Correlations and post-trade outcomes are descriptive research, not proof of predictive trading edge.

See `BTCUSD_Market_Mechanics_Fix_Report.md` for the fixes, validation notes and remaining limitations.
