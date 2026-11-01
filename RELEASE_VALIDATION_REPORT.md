# BTCUSD Market Mechanics Lab — Full-Scale Release Validation

Validation date: 2026-11-01  
Branch: `feature/workstation-hardening`  
Validated feature head: `e113f69be5cefe4af34ef3366f206eb038cb5dc3`  
`main` / `origin/main`: `880f0a5ef18170f29cb525513b3c0b7ad50b6c61`  
Working tree: clean at validation time (only the ignored local August archive is untracked)  
Stash: `stash@{0}` preserved  
PR #1: open, base `main`, head `ui/single-screen-workstation` `3c8599d`, mergeable

No application code, data, existing commits, stash, PR or deployment was modified during validation. The production site was used read-only for comparison. This report is committed on the feature branch after validation.

## 1. Repository state

- Feature commits on this branch: `3f1739e` (import/workspace hardening), `c42377f` (single-screen workstation), `de8d116` (fix-report hashes), `e113f69` (benchmark wording).
- The feature branch is **7 commits behind `origin/main`**. Those commits contain the UI copy audit, two dashboard script-syntax fixes, and compressed-ZIP regression tests. The feature branch independently rewrote the affected import block and has valid script syntax; the full archive import below proves the app runs.
- A read-only test merge (`git merge-tree --write-tree origin/main HEAD`) returned tree `a46245787bfbcdeaf0a258368f4455c4141568fc` with exit code 0: **no textual merge conflicts**.
- No PR exists for `feature/workstation-hardening`. Opening or merging one requires explicit authorization.

## 2. Full August archive import

### Archive

| Property | Value |
| --- | --- |
| File | `futures-trades-monthly-BTCUSD-2026-08.csv.zip` |
| SHA-256 | `E4A49421BDC10C3FD8AD0974EC00718F3313ABF58675D83575ABF7EA92F5E138` |
| Compressed size | 66,245,161 bytes (63.18 MiB) |
| ZIP entry | `BTCUSD_2026-08.csv` |
| Decompressed size | 391,774,302 bytes |
| Lines including header | 7,440,459 |
| Trade records | 7,440,458 |
| First / last timestamp | `2026-08-01 00:00:00.241134` / `2026-08-31 23:59:56.974182` |
| Symbols | BTCUSD only |
| Header | `product_symbol,price,size,timestamp,buyer_role` |

### Import result

| Run | Duration | Reported result |
| --- | --- | --- |
| First browser import | 8.28 s | `Import complete: 7,440,458 trade prints loaded across 31 days.` |
| Second browser import | 7.61 s | `Import complete: 7,440,458 trade prints loaded across 31 days.` |
| Lifecycle initial import | 9.55 s | same 31-day result |
| Re-import 1 / 2 / 3 | 9.43 s / 8.73 s / 8.76 s | matching dates replaced, not doubled |

The UI reported `7,440,458 trade prints · 31 loaded days` and the date range `2026-08-01 → 2026-08-31`. KPIs were:

`+24.96%` · `81,442.5 / 62,245` · `7,440,458` · `387.97M` · `-6.38M` · `-1.65%`

Peak sampled JS heap during the first import was **287.3 MB**; the lifecycle run sampled **290.1 MB** at "Reading BTCUSD_2026-08.csv: 292,293,970 bytes (75%) · 5,550,000 trades". Retained heap after import with forced GC was 115.4 MB. The maximum observed main-thread gap during import was **532.50 ms** (frame gap 516.60 ms), with progress updates every 25,000 rows.

### Daily rows

| Date | Rows | Executed size | Buy (taker) | Sell (maker) | Delta | Low | High |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-08-01 | 114,708 | 5,407,555 | 2,608,794 | 2,798,761 | -189,967 | 62,245 | 63,134 |
| 2026-08-02 | 146,664 | 7,511,930 | 3,754,180 | 3,757,750 | -3,570 | 62,788 | 63,786 |
| 2026-08-03 | 260,013 | 14,332,515 | 6,980,479 | 7,352,036 | -371,557 | 62,274 | 64,062 |
| 2026-08-04 | 249,240 | 13,667,733 | 6,860,662 | 6,807,071 | 53,591 | 63,301 | 64,519 |
| 2026-08-05 | 234,278 | 13,436,150 | 6,737,050 | 6,699,100 | 37,950 | 63,852.5 | 65,020.5 |
| 2026-08-06 | 210,109 | 11,428,913 | 5,669,274 | 5,759,639 | -90,365 | 64,149 | 64,978 |
| 2026-08-07 | 226,541 | 12,992,702 | 6,493,162 | 6,499,540 | -6,378 | 64,134 | 65,365 |
| 2026-08-08 | 77,403 | 3,363,788 | 1,663,261 | 1,700,527 | -37,266 | 64,794 | 65,169.5 |
| 2026-08-09 | 106,739 | 4,746,624 | 2,347,312 | 2,399,312 | -52,000 | 64,706 | 65,457 |
| 2026-08-10 | 213,538 | 11,801,495 | 5,795,448 | 6,006,047 | -210,599 | 63,792 | 65,381.5 |
| 2026-08-11 | 202,119 | 10,347,754 | 4,937,823 | 5,409,931 | -472,108 | 63,217.5 | 64,475.5 |
| 2026-08-12 | 198,613 | 10,554,012 | 5,326,570 | 5,227,442 | 99,128 | 63,287.5 | 64,452.5 |
| 2026-08-13 | 210,752 | 11,438,299 | 5,697,287 | 5,741,012 | -43,725 | 62,807 | 63,998 |
| 2026-08-14 | 189,452 | 10,331,195 | 5,057,752 | 5,273,443 | -215,691 | 62,505 | 63,602.5 |
| 2026-08-15 | 72,435 | 3,105,095 | 1,597,761 | 1,507,334 | 90,427 | 62,896 | 63,174.5 |
| 2026-08-16 | 81,287 | 3,762,761 | 1,799,163 | 1,963,598 | -164,435 | 62,687 | 63,376.5 |
| 2026-08-17 | 217,646 | 12,016,331 | 5,881,250 | 6,135,081 | -253,831 | 62,729.5 | 64,602 |
| 2026-08-18 | 178,812 | 9,370,758 | 4,614,264 | 4,756,494 | -142,230 | 64,008 | 65,035.5 |
| 2026-08-19 | 362,469 | 21,629,672 | 11,334,276 | 10,295,396 | 1,038,880 | 64,137.5 | 70,307.5 |
| 2026-08-20 | 402,570 | 21,564,310 | 10,683,781 | 10,880,529 | -196,748 | 68,898 | 73,385 |
| 2026-08-21 | 578,327 | 31,893,995 | 15,286,272 | 16,607,723 | -1,321,451 | 73,000 | 79,546.5 |
| 2026-08-22 | 283,071 | 13,219,029 | 6,387,351 | 6,831,678 | -444,327 | 76,520 | 78,840 |
| 2026-08-23 | 272,859 | 13,435,196 | 6,665,227 | 6,769,969 | -104,742 | 75,595.5 | 78,030 |
| 2026-08-24 | 453,685 | 22,377,747 | 10,715,102 | 11,662,645 | -947,543 | 76,658.5 | 79,982 |
| 2026-08-25 | 397,718 | 19,111,236 | 9,098,696 | 10,012,540 | -913,844 | 77,815.5 | 81,268 |
| 2026-08-26 | 275,135 | 13,042,432 | 6,459,364 | 6,583,068 | -123,704 | 77,609 | 79,208 |
| 2026-08-27 | 292,834 | 14,342,538 | 6,950,094 | 7,392,444 | -442,350 | 78,530.5 | 80,838.5 |
| 2026-08-28 | 314,037 | 16,420,929 | 7,907,990 | 8,512,939 | -604,949 | 76,860.5 | 81,442.5 |
| 2026-08-29 | 132,301 | 5,626,847 | 2,867,731 | 2,759,116 | 108,615 | 77,360.5 | 78,316.5 |
| 2026-08-30 | 193,629 | 9,161,883 | 4,322,878 | 4,839,005 | -516,127 | 76,966.5 | 79,386.5 |
| 2026-08-31 | 291,474 | 16,533,263 | 8,295,010 | 8,238,253 | 56,757 | 77,358 | 79,232 |

All 31 dates were present. The independent source scan found 3,743,822 maker rows and 3,696,636 taker rows, no exact duplicate rows, timestamps monotonic within each day, and no date outside 2026-08-01…2026-08-31.

## 3. Independent numerical verification

The reference implementation (`reference.py`) streams the source CSV directly from the ZIP and recomputes each day without importing any application module. It then compares every day against a 21.1 MB workspace exported by the dashboard itself. Relative tolerance was `1e-9`; integer counts were exact.

Compared per day:

1. Row count, start/end price, return, low, high, range, executed size, buy size, sell size, delta, imbalance, median/p90/p95/p99/max size, active-second percentage.
2. Every 1-minute bar field: time, open, high, low, close, volume, print count, buy, sell, delta, price×size.
3. Every 1-hour bar, same fields.
4. Every $5 volume-profile bucket (minute, price bucket, volume, signed flow).
5. The full 1,440 × 9 per-minute trade-size histogram.
6. Every large-trade event (size ≥ 220) including the 1-minute, 5-minute and 15-minute follow-through returns.
7. Minute flow/return Pearson correlation.

Result: **31 of 31 days matched; 0 failures.**

Global totals:

| Metric | Independent reference | Dashboard |
| --- | ---: | ---: |
| Trade prints | 7,440,458 | 7,440,458 |
| Executed size | 387,974,687 | 387.97M |
| Buy size | 190,795,264 | — (verified per day) |
| Sell size | 197,179,423 | — (verified per day) |
| Cumulative delta | -6,384,159 | -6.38M |
| Flow imbalance | -1.6455% | -1.65% |
| Low / high | 62,245 / 81,442.5 | 62,245 / 81,442.5 |
| Window return | +24.96% | +24.96% |

No tolerance was loosened and no discrepancy was suppressed.

## 4. Chart validation on the full dataset

All nine charts were rendered from the imported archive. Trace counts are the actual arrays passed to Plotly (price/flow/CVD are downsampled by the chart subsetter; the daily aggregates above remain full precision).

| Chart | First render | Trace content | Hover |
| --- | ---: | --- | --- |
| priceChart | 154 ms | candlestick (BTCUSD): 3,189; scattergl (Buyer role: taker): 765; scattergl (Buyer role: maker*): 835 | yes |
| flowChart | 464 ms | bar (Buy-side proxy size): 3,189; bar (Sell-side proxy size): 3,189; scatter (Rolling imbalance): 3,190 | yes |
| cvdChart | 297 ms | scatter (CVD · cumulative within selected window): 3,190 | yes |
| profileChart | 310 ms | bar (Executed size): 1,921 | yes |
| sizeChart | 260 ms | bar (Print count): 9; scatter (Cumulative %): 9 | yes |
| hourChart | 292 ms | bar (Trade prints): 744; scatter (Net signed flow): 744 | yes |
| eventChart | 339 ms | bar (Buyer taker): 3; bar (Buyer maker*): 3 | yes |
| leadLagChart | 261 ms | bar (Pearson r): 6 | yes |
| regimeChart | 245 ms | heatmap: 24 [31×24] | yes* |

- Hover tooltips were present for all nine charts (the heatmap required an `{xval,yval}` hover call; a real mouse move also produced its tooltip).
- Wheel zoom, Shift-drag pan and double-click reset worked on Price, Flow and CVD, restoring the original range exactly.
- Resizing 1280 → 1000 px changed the plot from 1258 to 978 px with **0 `Plotly.react`** and 3 resizes in 641 ms.
- A cached two-pass cycle over all nine charts took **2972 ms** with **0 `Plotly.react` calls**, 6 relayouts (focus cursor on time charts) and 18 resizes.
- Date filter 2026-08-10…2026-08-12 reported **614,270** prints, exactly the reference count (614,270).
- Intraday 09:00–10:00 across all 31 days reported **7,219,907**, exactly the continuous-window reference count (7,219,907).
- Timeframe 5m produced 2,973 bars in 265 ms; returning to 1m produced 3,189 bars. Total react calls for both switches: 2.
- Console: 0 errors, 0 page errors, 0 failed requests; one Plotly Canvas2D `willReadFrequently` warning.

## 5. Replay

- Slider range: 0…44,572 one-minute bars across the full window.
- Next/previous moved exactly one bar; scrubbing to 500 showed `2026-08-01 08:20:00.000 · supplied timestamp` with the correct per-bar metrics.
- 4× playback advanced 7 bars in 1.6 s; pausing held the value stable (507 → 507).
- 12× playback advanced 17 bars in 1.2 s.
- The cursor persisted across chart switches: a probe set index 500 (`2026-08-01 08:20:00.000`), then switched Price → Flow → CVD → Price; the slider stayed at 500 and every time chart carried the same line at `1785572400000`. The replay session produced 20 relayouts.
- Restricting the range to one day clamped the slider to max 1439, value 0, with no errors.
- Replay steps over the chronological combined 1-minute bars; no raw trade array is retained or replayed, so stale or duplicated trades cannot enter the cursor metrics.

## 6. Import robustness

22 controlled browser cases, each run through the real import UI. Failure/cancellation cases first loaded a 2-day baseline and then verified that the baseline KPI and date range were unchanged.

| Case | Result | Detail |
| --- | --- | --- |
| single CSV | pass | Import complete: 12 trade prints loaded across 2 days. |
| two CSV files | pass | Import complete: 24 trade prints loaded across 4 days. |
| two ZIP archives | pass | Import complete: 24 trade prints loaded across 4 days. |
| CSV plus ZIP | pass | Import complete: 24 trade prints loaded across 4 days. |
| stored ZIP entry | pass | Import complete: 12 trade prints loaded across 2 days. |
| sequential imports accumulate | pass | Import complete: 24 trade prints loaded across 4 days. |
| re-import same dates replaces | pass | Import complete: 12 trade prints loaded across 2 days. |
| sequential overlap replaces matching date | pass | Import complete: 12 trade prints loaded across 2 days. |
| overlap within one batch rejected | pass | Import failed: More than one selected file contains trades for 2026-07-02. Import the monthly archive by itself or remove overlapping CSV/ZIP files from the selection. |
| partial batch failure commits nothing | pass | Import failed: Invalid price at CSV row 5. Prices must be positive numbers. |
| empty CSV | pass | Import failed: No valid trade rows were found in this file. |
| header-only CSV | pass | Import failed: No valid trade rows were found in this file. |
| malformed price | pass | Import failed: Invalid price at CSV row 5. Prices must be positive numbers. |
| unsupported role | pass | Import failed: Unknown buyer_role "banana" at CSV row 8. Expected maker or taker; the file was not imported to avoid silently misclassifying flow. |
| unsupported symbol | pass | Import failed: This dashboard is for BTCUSD, BTCUSDT or BTCUSD_PERP, but CSV row 2 has product_symbol="ETHUSD". Mixed or different symbols are not combined. |
| corrupt ZIP | pass | Import failed: Could not read ZIP directory in corrupt.zip. |
| ZIP without CSV | pass | Import failed: No CSV file was found inside nocsv.zip. |
| repeated headers | pass | Import complete: 12 trade prints loaded across 2 days. |
| headerless CSV | pass | Import complete: 12 trade prints loaded across 2 days. |
| unsupported extension | pass | No CSV or ZIP trade files were found in that selection. |
| cancel during decompression | pass | Cancelled in 690 ms |
| cancel during parsing | pass | Cancelled in 753 ms; at "Reading BTCUSD_2026-08.csv: 2,676,205 bytes (1%) · 50,000 trades" |

Additional checks: a successful batch commits only after every selected file parses; a batch containing one valid file and one malformed file commits nothing; overlapping dates inside one batch are rejected, while a later single-file import of the same date replaces it. Zero page errors across all cases.

## 7. Memory lifecycle

| Phase | Heap used | Heap total | DOM nodes | Listeners |
| --- | ---: | ---: | ---: | ---: |
| initial load | 7.5 MB | 8.5 MB | 1,378 | 156 |
| after full import | 115.2 MB | 118.4 MB | 8,060 | 244 |
| after first render of all charts | 122.1 MB | 123.7 MB | 28,834 | 724 |
| after chart cycle 1 | 122.6 MB | 123.7 MB | 28,834 | 724 |
| after chart cycle 2 | 122.6 MB | 123.9 MB | 28,834 | 724 |
| after chart cycle 3 | 122.6 MB | 123.7 MB | 28,834 | 724 |
| after replay | 122.5 MB | 123.4 MB | 28,848 | 724 |
| after workspace export | 122.5 MB | 123.7 MB | 28,852 | 724 |
| after re-import 1 | 122.8 MB | 125.7 MB | 28,852 | 724 |
| after re-import 1 + all charts | 123.7 MB | 125.2 MB | 29,324 | 722 |
| after re-import 2 | 120 MB | 123.5 MB | 29,324 | 722 |
| after re-import 2 + all charts | 123.8 MB | 125.9 MB | 29,323 | 721 |
| after re-import 3 | 120.3 MB | 123.5 MB | 29,323 | 721 |
| after re-import 3 + all charts | 124 MB | 126.7 MB | 29,323 | 721 |

- Three full chart-switch cycles retained exactly **122.6 → 122.6 → 122.6 MB** — no growth.
- Three full re-imports retained 122.8 → 120 → 120.3 MB; after rendering all charts each time: 123.7 → 123.8 → 124 MB.
- Workspace export: 2261 ms for 21,140,622 bytes; restore in a fresh page: 2088 ms to "Loaded 31 days from the workspace. Data for matching dates was replaced.", retained heap 95.1 MB.
- No duplicate retained dataset, worker leak or repeated-import growth was observed.

## 8. Interface and viewport matrix

Full 31-day data was restored into each viewport. "Switch" is the time to select a chart and wait for its Plotly SVG.

| Viewport | Active charts | Horizontal overflow | Plot size | Chart switch | Replay footer visible | Drawer focus/close |
| --- | ---: | --- | --- | --- | --- | --- |
| 360x800 mobile | 1 | no | 346×390 | 143–391 ms | yes | yes |
| 390x844 mobile | 1 | no | 376×444 | 137–410 ms | yes | yes |
| 412x915 mobile | 1 | no | 398×515 | 138–390 ms | yes | yes |
| 768x1024 desktop | 1 | no | 746×658 | 154–420 ms | yes | yes |
| 1280x720 desktop | 1 | no | 1258×404 | 155–423 ms | yes | yes |
| 1920x1080 desktop | 1 | no | 1898×763 | 152–422 ms | yes | yes |
| 800x360 mobile | 1 | no | 778×182 | 149–448 ms | yes | yes |
| 844x390 mobile | 1 | no | 822×212 | 139–448 ms | yes | yes |
| 915x412 mobile | 1 | no | 893×234 | 151–449 ms | yes | yes |

- All nine charts rendered populated canvases in every viewport; the chart picker is the tab strip above 760 px and the labelled `select` at or below 760 px.
- Replay slider and play/pause were inside the viewport and were the top element at their centre in every case.
- The filter drawer opened fully inside the viewport, moved focus inside, and closed with Escape in every case.
- Maximizing a chart stayed inside the viewport (e.g. 360×800 → 352×798 with a 334×729 plot).
- No horizontal overflow: `document.scrollWidth === innerWidth` in all nine cases. Safe-area insets are applied to the shell, drawer and maximized chart, and the viewport meta includes `viewport-fit=cover`.
- Touch targets: header actions and chart tabs are 44 px at mobile breakpoints; drawer controls are 40–44 px. The replay transport buttons measure 40 px high and the range input 18 px high; both are usable but below the 44 px guideline. This is a minor polish item, not a functional blocker.
- The legacy `.mobile-action-bar` CSS and `src/ui/mobile-quick-actions.js` are not wired into the current shell (the workstation header replaces them). Dead code only; no runtime effect.

### Physical Android

The Samsung Galaxy A35 was **not available**. All mobile results above are Chromium emulation with desktop-class hardware, not physical-device validation. Manual checklist for the device:

1. Load the GitHub Pages URL over Wi-Fi and over mobile data; confirm the shell, fonts and Plotly library appear.
2. Import the 66 MB August ZIP; note time, progress updates, peak memory in Chrome remote inspection, and whether the tab stays responsive.
3. Cancel an import during decompression and during parsing; confirm the previous dataset and KPIs remain.
4. Switch through all nine charts; confirm one chart at a time, readable axes, working tooltips and no clipped canvas in portrait.
5. Rotate to landscape; confirm the KPI strip hides, the chart keeps usable height, and the replay footer remains reachable.
6. Use the replay scrubber, play/pause, 4× and 12× speeds; confirm the cursor and metrics track and survive chart switches.
7. Open Filters, change dates and the 09:00–10:00 window, close with the back gesture/Escape equivalent, and confirm focus returns.
8. Save a workspace, reload the page, restore it, and confirm the active chart and filters return.
9. Background/foreground the browser during and after import; confirm no crash and no duplicated days.
10. Repeat the import once and confirm the retained memory does not grow across cycles.

## 9. Service worker and GitHub Pages

Tested under a local `/dashboard/` subpath, matching the project Pages URL shape:

- `/dashboard/` redirected to the app and rendered it.
- The app loaded correctly from the direct `.html` URL.
- The service worker registered with scope `http://127.0.0.1:8124/dashboard/` and controlled the page.
- Cache `btc-mechanics-shell-v25` contained the shell, all 13 local modules, the manifest/icon and `https://cdn.plot.ly/plotly-3.3.1.min.js` (19 entries).
- Refresh loaded the app and Plotly.
- With the network disabled, a reload still rendered the chart shell and Plotly from cache, showing the no-data state.
- Returning online reloaded normally.
- No page errors, console errors or failed requests.
- `index.html` uses relative redirects; `manifest.webmanifest` uses relative `id`, `start_url` and `scope`; `sw.js` derives `ROOT` from `registration.scope`. All work under the project subpath.

## 10. Automated tests and CI

- Local suite: `node --test tests` → **75 passed, 0 failed** (283 ms).
- The feature workflow runs the complete suite (`node --test tests`), not only the importer file.
- Latest `main` CI run for `880f0a5` (Importer and data-integrity tests): **success**, 14 s; the Pages deployment for the same commit: **success**, 41 s.
- PR #1 checks: **pass** (8 s).
- `feature/workstation-hardening` pushes do not trigger CI because the workflow runs only on `main` pushes and pull requests. A PR from this branch will run the full suite.
- No new regression test was needed: no reproducible application defect was found. The only harness issues during validation were test-script bugs (date-axis string arithmetic, mobile chart picker selection), and they were corrected in the harness, not the app.

## 11. Release recommendation

**READY AFTER PHYSICAL ANDROID VALIDATION.**

The real 7,440,458-trade August archive imports correctly, every one of the 31 days matches an independent Python reference for counts, volume, buy/sell, CVD, OHLC, 1m/1h bars, profile, histogram, events and correlation, all nine charts render and interact, replay is consistent, failed/cancelled imports preserve prior data, memory is stable across repeated imports and chart cycles, and all nine viewports plus the Pages subpath/offline shell pass.

Remaining blockers and release actions:

1. **Physical Samsung Galaxy A35 validation** using the checklist above. This is the only technical validation gap.
2. **Release process:** the feature branch is 7 commits behind `origin/main` and has no PR. A test merge is conflict-free, but opening and merging a PR requires explicit authorization; CI has not run on this branch. Do not merge or deploy without that authorization.
3. Minor, non-blocking polish: replay transport buttons are 40 px and the scrubber is 18 px high (below the 44 px touch guideline); the unused mobile action-bar CSS/module can be removed in a later cleanup.
