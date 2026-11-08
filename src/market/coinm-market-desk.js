import { MARKET_INTERVALS, SECOND_INTERVALS, COINM_CONTRACT_USD, createCoinMMarketFeed } from './coinm-market-data.js';
import { createDepthArchiveStore } from './coinm-depth-archive.js';

const integer = value => Math.round(Number(value) || 0).toLocaleString('en-US');
const number = (value, digits = 2) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const contractQty = value => {
  const n = Number(value) || 0;
  return n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n % 1) > 1e-9 ? 3 : 0 });
};
const signedContractQty = value => {
  const n = Number(value) || 0;
  return (n > 0 ? '+' : '') + contractQty(n);
};
const utcTime = ms => new Date(Number(ms)).toISOString().slice(11, 23);
const utcMinute = ms => new Date(Number(ms)).toISOString().slice(11, 16);
const intervalLabel = value => (MARKET_INTERVALS.find(item => item.value === value) || { label: value }).label;
const percent = value => {
  const n = Number(value) || 0;
  return (n > 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
};

export function mountCoinMMarketDesk({ root, Plotly = window.Plotly, getImportedBars = () => [] } = {}) {
  if (!root) return { activate() {}, syncImportedBars() {}, getInterval() { return null; }, setInterval() {} };
  root.innerHTML = [
    '<div class="md-root" data-feed="disconnected">',
      '<div class="md-topbar">',
        '<div class="md-title"><div class="md-kicker">BINANCE COIN-M · BTCUSD_PERP</div><strong>Live candles, executed flow &amp; public depth</strong><small>Exchange OHLC · aggregate trades · sequenced depth · 1 contract = $' + COINM_CONTRACT_USD + ' face value</small></div>',
        '<div class="md-controls"><label for="mdInterval">Candle timeframe<select id="mdInterval"></select></label><button class="btn primary" id="mdConnect" type="button" aria-pressed="false">Connect live</button></div>',
      '</div>',
      '<div class="md-statusline"><span id="mdState" class="md-state md-disconnected">DISCONNECTED</span><span id="mdFresh" class="md-fresh md-fresh-idle">Feed paused</span><span id="mdDetail" class="md-detail" aria-live="polite">Connect to load the latest 1,000 exchange candles and live market data.</span><span id="mdSource">No candle source</span></div>',
      '<div class="md-metrics">',
        '<div><span>Last trade</span><strong id="mdPrice">—</strong><small>USD · COIN-M perpetual</small></div>',
        '<div><span>BUY TAKER · SELL MAKER</span><strong id="mdBuyTaker">—</strong><small>Contracts since connection</small></div>',
        '<div><span>SELL TAKER · BUY MAKER</span><strong id="mdSellTaker">—</strong><small>Contracts since connection</small></div>',
        '<div><span>Net taker delta</span><strong id="mdDelta">—</strong><small>Buy taker − sell taker</small></div>',
        '<div><span>Best spread</span><strong id="mdSpread">—</strong><small>USD · best ask − best bid</small></div>',
      '</div>',
      '<div class="md-layout">',
        '<div class="md-col md-chart-column">',
          '<section class="md-panel md-panel-grow"><div class="md-panel-head"><div><strong>Exchange candlesticks</strong><small id="mdCandleMeta">Waiting for market data</small></div><div style="display:flex;align-items:center;gap:7px"><button class="btn" id="mdLoadOlder" type="button" disabled style="min-height:25px;padding:2px 7px;font-size:10px">Load older</button><span class="md-unit">contracts</span></div></div><div class="md-chart-wrap"><div id="mdCandles" class="md-candles" aria-label="Live Binance COIN-M candlestick chart"></div><div id="mdCandleEmpty" class="md-empty md-overlay">Connect live to load historical Binance COIN-M candles.</div></div></section>',
          '<section class="md-panel md-flow-panel"><div class="md-panel-head"><div><strong>Executed volume by aggressor</strong><small>Green = BUY TAKER / SELL MAKER · Red = SELL TAKER / BUY MAKER</small></div><span class="md-unit">contracts</span></div><div class="md-flow-wrap"><div id="mdFlow" class="md-flow" aria-label="Executed volume by aggressor"></div></div></section>',
        '</div>',
        '<div class="md-col md-flow-column">',
          '<section class="md-panel md-panel-grow md-footprint-panel"><div class="md-panel-head"><div><strong>Per-price footprint</strong><small id="mdFootprintMeta">Session history · waiting for executions</small></div><div style="display:flex;align-items:center;gap:6px"><select id="mdFootprintTf" aria-label="Footprint aggregation timeframe" style="max-width:62px;min-width:55px;font-size:10px"><option value="1">1m</option><option value="5">5m</option><option value="15">15m</option></select><select id="mdFootprintRange" aria-label="Historical footprint backfill range" style="max-width:76px;min-width:60px;font-size:10px"><option value="60">60m</option><option value="240">4h</option></select><button class="btn" id="mdBackfillFootprint" type="button" style="min-height:25px;padding:2px 7px;font-size:10px">Backfill 60m</button><select id="mdFootprintMinute" aria-label="Select recorded footprint minute" style="max-width:145px;min-width:0;font-size:10px"><option value="live">Follow live minute</option></select><span class="md-unit">contracts</span></div></div><div class="md-footprint-legend"><span>BUY TAKER / SELL MAKER</span><span>SELL TAKER / BUY MAKER</span><span>Delta = buy − sell</span></div><div class="md-table-wrap"><table class="md-footprint"><thead><tr><th>Price</th><th>Buy taker<br><small>Sell maker</small></th><th>Sell taker<br><small>Buy maker</small></th><th>Delta</th><th>Diagonal</th><th>Prints</th><th>Profile</th></tr></thead><tbody id="mdFootprintRows"><tr><td colspan="7" class="md-muted">Connect live to collect current-minute executions by price.</td></tr></tbody></table></div><div class="md-panel-foot" id="mdFootprintFoot">Backfill 60 minutes or 4 hours of Binance aggregate trades (48-hour API lookback), or import/export recorded depth captures. Historical public order-book archives are not provided by this endpoint.</div></section>',
        '</div>',
        '<div class="md-col md-side-column">',
          '<section class="md-panel md-panel-grow md-book-panel"><div class="md-panel-head"><div><strong>Order book</strong><small id="mdBookState">Not synchronized</small></div><span class="md-unit">contracts</span></div><div class="md-depth-controls" style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:4px 7px;border-bottom:1px solid #203047"><button class="btn" id="mdRecordDepth" type="button" style="min-height:25px;padding:2px 7px;font-size:10px">Record depth</button><input id="mdDepthReplay" type="range" min="0" max="0" value="0" step="1" disabled aria-label="Replay captured order-book samples" style="width:76px;min-width:48px;flex:1"><button class="btn" id="mdDepthLive" type="button" disabled style="min-height:25px;padding:2px 7px;font-size:10px">Live</button><button class="btn" id="mdDepthExport" type="button" disabled style="min-height:25px;padding:2px 7px;font-size:10px">Export</button><label class="btn" for="mdDepthImport" style="min-height:25px;padding:2px 7px;font-size:10px;display:inline-flex;align-items:center;cursor:pointer">Import</label><input id="mdDepthImport" type="file" accept="application/json,.json" hidden><small id="mdDepthReplayMeta" style="font-size:9px;color:#91a3bb">Not recording · session only</small></div><div class="md-book-summary"><span>Bid <b id="mdBestBid">—</b></span><span>Spread <b id="mdBookSpread">—</b></span><span>Ask <b id="mdBestAsk">—</b></span></div><div class="md-table-wrap"><table class="md-book"><thead><tr><th>Bid qty</th><th>Bid price</th><th>Ask price</th><th>Ask qty</th></tr></thead><tbody id="mdBookRows"><tr><td colspan="4" class="md-muted">Connect to synchronize depth.</td></tr></tbody></table></div><div class="md-panel-foot" id="mdBookFoot">Depth is aggregated by price level, not individual order IDs.</div></section>',
          '<section class="md-panel md-heatmap-panel"><div class="md-panel-head"><div><strong>Historical liquidity heatmap</strong><small id="mdHeatmapMeta">Record or import depth to build history</small></div><span class="md-unit">contracts</span></div><div id="mdDepthHeatmap" style="height:190px;min-height:150px;width:100%" aria-label="Historical bid and ask liquidity heatmap"></div></section>',
          '<section class="md-panel md-tape-panel"><div class="md-panel-head"><div><strong>Live trade tape</strong><small id="mdTapeMeta">Waiting for aggregate trades</small></div><span class="md-unit">contracts</span></div><div class="md-tape-head"><span>UTC</span><span>Price</span><span>Qty</span><span>Aggressor → passive</span></div><div id="mdTape" class="md-tape"><div class="md-empty">Waiting for aggregate trades…</div></div></section>',
        '</div>',
      '</div>',
      '<details class="md-footnote"><summary>Data semantics and limits</summary><p><b>COIN-M contract units:</b> kline volume, aggregate-trade quantity and depth quantity are contracts. BTCUSD_PERP uses 100 USD face value per contract; the interface never relabels contracts as BTC or USD notional. Binance aggregate trades expose whether the buyer was maker: buyer maker = false is BUY TAKER / SELL MAKER, buyer maker = true is SELL TAKER / BUY MAKER. Both sides are mirrored views of one execution, never additional volume. Candles from 1m upward are exchange klines; seconds candles are built only from executions observed in this session and are not historical reconstructions. Public depth is aggregated at each price and does not expose maker identities or queue position. Footprint diagonal imbalance compares the next observed traded price level, not a guaranteed one-tick neighbor. Optional recording keeps a bounded series of top-25 bid/ask snapshots. IndexedDB retains up to 50,000 samples locally across reloads; JSON export/import moves captures between devices. It cannot backfill earlier depth or reconstruct unrecorded updates. Quantity reductions can be executions or cancellations and the public diff does not label which.</p></details>',
    '</div>'
  ].join('');

  const $ = id => root.querySelector('#' + id);
  const intervalSelect = $('mdInterval');
  for (const item of MARKET_INTERVALS) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label + (SECOND_INTERVALS.includes(item.value) ? ' · live built' : ' · exchange');
    intervalSelect.appendChild(option);
  }
  intervalSelect.value = '1m';

  let interval = '1m';
  let connected = false;
  let candles = [];
  let source = '';
  let recentTrades = [];
  let renderTimer = null;
  let pendingDraw = false;
  let tapeTimer = null;
  let pendingTape = [];
  let footprintTimer = null;
  let pendingFootprint = null;
  let bookTimer = null;
  let pendingBook = null;
  let resizeTimer = null;
  let freshTimer = null;
  let lastMarketAt = null;
  let lastCandlesInterval = null;
  let feedState = 'disconnected';
  let candleHistoryHasMore = false;
  let loadingOlderCandles = false;
  let selectedFootprintMinute = 'live';
  let selectedFootprintInterval = 1;
  let footprintOptionKey = '';
  let latestBookView = null;
  let replayingDepth = false;
  let selectedReplayTime = null;
  let depthHeatmapTimer = null;
  const depthArchive = createDepthArchiveStore({ maxSamples: 10000 });
  let persistedDepthCount = 0;
  let archiveWrite = Promise.resolve();
  let pendingArchiveSamples = [];
  let archiveFlushTimer = null;

  function imported(tf) {
    try {
      const bars = getImportedBars(tf);
      return Array.isArray(bars) ? bars : [];
    } catch (_) {
      return [];
    }
  }
  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }
  function setVisible(id, visible) {
    const el = $(id);
    if (el) el.hidden = !visible;
  }
  function updateFreshness() {
    const el = $('mdFresh');
    if (!el) return;
    let text = 'Feed paused';
    let tone = 'idle';
    if (connected) {
      if (lastMarketAt === null) {
        text = 'Waiting for first live message';
        tone = 'waiting';
      } else {
        const age = Math.max(0, Date.now() - lastMarketAt);
        const seconds = age < 10000 ? (age / 1000).toFixed(1) : String(Math.round(age / 1000));
        if (age < 5000) {
          text = 'Live · ' + seconds + 's ago';
          tone = 'live';
        } else if (age < 45000) {
          text = 'Quiet · ' + seconds + 's ago';
          tone = 'quiet';
        } else {
          text = 'STALE · ' + seconds + 's ago';
          tone = 'stale';
        }
      }
    }
    el.textContent = text;
    el.className = 'md-fresh md-fresh-' + tone;
  }
  function setStatus(state, message) {
    feedState = state;
    const labels = {
      connected: 'LIVE', syncing: 'SYNCING', connecting: 'CONNECTING', reconnecting: 'RECONNECTING',
      warning: 'WARNING', error: 'ERROR', disconnected: 'DISCONNECTED'
    };
    connected = ['connecting', 'connected', 'syncing', 'reconnecting', 'warning'].includes(state);
    const stateEl = $('mdState');
    if (stateEl) {
      stateEl.textContent = labels[state] || String(state || '').toUpperCase();
      stateEl.className = 'md-state md-' + state;
    }
    setText('mdDetail', message || '');
    const button = $('mdConnect');
    if (button) {
      button.textContent = connected ? 'Disconnect' : 'Connect live';
      button.classList.toggle('md-disconnect', connected);
      button.setAttribute('aria-pressed', connected ? 'true' : 'false');
    }
    const shell = root.querySelector('.md-root');
    if (shell) shell.dataset.feed = state;
    if (state === 'disconnected') lastMarketAt = null;
    updateFreshness();
  }
  function mergeCandles(a, b) {
    const map = new Map();
    for (const candle of a || []) map.set(Number(candle.t), candle);
    for (const candle of b || []) map.set(Number(candle.t), candle);
    return Array.from(map.values()).sort((x, y) => x.t - y.t).slice(-5000);
  }
  function scheduleDraw() {
    pendingDraw = true;
    if (renderTimer !== null) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (!pendingDraw) return;
      pendingDraw = false;
      drawCharts();
    }, 240);
  }
  function drawCharts() {
    const candleEl = $('mdCandles');
    if (!candleEl) return;
    const candleBox = candleEl.getBoundingClientRect();
    if (candleBox.width < 60 || candleBox.height < 40) return;
    const visible = candles.slice(-5000);
    if (!visible.length) {
      setVisible('mdCandleEmpty', true);
      setText('mdCandleMeta', 'No candles for this interval yet');
      if (Plotly && Plotly.purge) {
        try { Plotly.purge(candleEl); Plotly.purge($('mdFlow')); } catch (_) {}
      }
      return;
    }
    setVisible('mdCandleEmpty', false);
    setText('mdCandleMeta', integer(visible.length) + ' candles shown' + (candles.length > visible.length ? ' · latest ' + integer(visible.length) + ' of ' + integer(candles.length) : '') + (candles.length >= 5000 ? ' · 5,000-bar memory cap' : ''));
    if (!Plotly || typeof Plotly.react !== 'function') {
      setText('mdCandleMeta', 'Plotly unavailable; the live data stream remains active.');
      return;
    }
    const x = visible.map(candle => Number(candle.t));
    const candleTrace = {
      type: 'candlestick', name: 'BTCUSD_PERP', x,
      open: visible.map(candle => candle.o), high: visible.map(candle => candle.h),
      low: visible.map(candle => candle.l), close: visible.map(candle => candle.c),
      customdata: visible.map(candle => [candle.v, candle.buyTaker, candle.sellTaker, candle.trades]),
      increasing: { line: { color: '#48d6ad', width: 1 }, fillcolor: '#48d6ad' },
      decreasing: { line: { color: '#ff7e87', width: 1 }, fillcolor: '#ff7e87' },
      whiskerwidth: 0.35,
      hovertemplate: '%{x|%Y-%m-%d %H:%M:%S UTC}<br>O %{open:,.1f} · H %{high:,.1f}<br>L %{low:,.1f} · C %{close:,.1f}<br>Total qty %{customdata[0]:,.0f} contracts<br>BUY TAKER / SELL MAKER %{customdata[1]:,.0f}<br>SELL TAKER / BUY MAKER %{customdata[2]:,.0f}<br>Trades %{customdata[3]:,.0f}<extra></extra>'
    };
    const baseLayout = {
      height: Math.max(80, Math.round(candleBox.height)),
      paper_bgcolor: '#0c1422', plot_bgcolor: '#0c1422',
      font: { color: '#dce7f5', size: 10, family: 'Inter,system-ui,sans-serif' },
      margin: { l: 10, r: 54, t: 6, b: 30 }, showlegend: false, hovermode: 'x',
      uirevision: 'coinm-' + interval,
      xaxis: { type: 'date', gridcolor: '#203047', linecolor: '#203047', tickfont: { color: '#91a3bb' }, rangeslider: { visible: true, thickness: 0.06, bgcolor: '#091220', bordercolor: '#203047' } },
      shapes: selectedReplayTime ? [{ type: 'line', x0: selectedReplayTime, x1: selectedReplayTime, y0: 0, y1: 1, yref: 'paper', line: { color: '#f3c969', width: 1, dash: 'dot' } }] : [],
      yaxis: { side: 'right', gridcolor: '#203047', linecolor: '#203047', tickfont: { color: '#91a3bb' }, fixedrange: false }
    };
    const config = { responsive: true, displaylogo: false, scrollZoom: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };
    try {
      const pending = Plotly.react(candleEl, [candleTrace], baseLayout, config);
      if (pending && typeof pending.catch === 'function') pending.catch(error => setText('mdCandleMeta', 'Candlestick render failed: ' + String(error)));
      const flowEl = $('mdFlow');
      if (flowEl && flowEl.getBoundingClientRect().width >= 60) {
        const flowBox = flowEl.getBoundingClientRect();
        const compactFlow = flowBox.height < 70;
        const buy = visible.map(candle => Number(candle.buyTaker || 0));
        const sell = visible.map(candle => -Number(candle.sellTaker || 0));
        const layout = {
          height: Math.max(32, Math.round(flowBox.height)),
          paper_bgcolor: '#0c1422', plot_bgcolor: '#0c1422',
          font: { color: '#dce7f5', size: compactFlow ? 7 : 9 },
          margin: compactFlow ? { l: 4, r: 48, t: 2, b: 2 } : { l: 10, r: 54, t: 4, b: 28 },
          barmode: 'relative', showlegend: !compactFlow,
          legend: { orientation: 'h', x: 0, y: 1.25, font: { size: 8, color: '#91a3bb' } },
          xaxis: { type: 'date', gridcolor: '#203047', linecolor: '#203047', showticklabels: !compactFlow, tickfont: { color: '#91a3bb' } },
          yaxis: { title: compactFlow ? '' : 'Contracts', side: 'right', gridcolor: '#203047', tickfont: { color: '#91a3bb', size: compactFlow ? 6 : 9 }, nticks: compactFlow ? 2 : 5 },
          uirevision: 'coinm-flow-' + interval
        };
        const traces = [
          { type: 'bar', name: 'BUY TAKER / SELL MAKER', x, y: buy, marker: { color: '#48d6ad', opacity: 0.85 }, hovertemplate: '%{x|%Y-%m-%d %H:%M:%S UTC}<br>BUY TAKER · SELL MAKER %{y:,.0f} contracts<extra></extra>' },
          { type: 'bar', name: 'SELL TAKER / BUY MAKER', x, y: sell, customdata: sell.map(value => -value), marker: { color: '#ff7e87', opacity: 0.85 }, hovertemplate: '%{x|%Y-%m-%d %H:%M:%S UTC}<br>SELL TAKER · BUY MAKER %{customdata:,.0f} contracts<extra></extra>' }
        ];
        const flowPending = Plotly.react(flowEl, traces, layout, config);
        if (flowPending && typeof flowPending.catch === 'function') flowPending.catch(() => {});
      }
    } catch (error) {
      setText('mdCandleMeta', 'Chart render failed: ' + String(error));
    }
  }
  function updateCandleHistoryControls() {
    const button = $('mdLoadOlder');
    if (!button) return;
    const exchangeInterval = MARKET_INTERVALS.some(item => item.value === interval && !SECOND_INTERVALS.includes(item.value));
    button.hidden = !exchangeInterval;
    button.disabled = !exchangeInterval || loadingOlderCandles || !candleHistoryHasMore || candles.length === 0 || candles.length >= 5000;
    button.textContent = loadingOlderCandles ? 'Loading…' : candles.length >= 5000 ? '5,000 loaded' : 'Load older';
  }
  function setCandleData(next, nextSource) {
    candles = Array.isArray(next) ? next.slice() : [];
    source = nextSource || '';
    setText('mdSource', source);
    setVisible('mdCandleEmpty', candles.length === 0);
    updateCandleHistoryControls();
    scheduleDraw();
  }
  function updateStats(stats) {
    if (!stats) return;
    setText('mdPrice', stats.lastPrice === null || stats.lastPrice === undefined ? '—' : number(stats.lastPrice, 1));
    setText('mdBuyTaker', contractQty(stats.buyTaker));
    setText('mdSellTaker', contractQty(stats.sellTaker));
    const delta = Number(stats.delta || 0);
    setText('mdDelta', signedContractQty(delta));
    const deltaEl = $('mdDelta');
    if (deltaEl) deltaEl.className = delta > 0 ? 'md-positive' : delta < 0 ? 'md-negative' : '';
    setText('mdTapeMeta', integer(stats.events) + ' prints · ' + contractQty(stats.qty) + ' contracts');
  }
  function cell(text, className, tag = 'td') {
    const el = document.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function queueBook(view) {
    pendingBook = view;
    if (bookTimer !== null) return;
    bookTimer = setTimeout(() => {
      bookTimer = null;
      if (!replayingDepth) renderBook(pendingBook);
    }, 220);
  }
  function renderBook(view) {
    if (!view || !view.ready) {
      setText('mdBookState', 'Waiting for sequence sync');
      const rows = $('mdBookRows');
      if (rows) rows.innerHTML = '<tr><td colspan="4" class="md-muted">Waiting for a synchronized depth snapshot…</td></tr>';
      setText('mdSpread', '—');
      setText('mdBestBid', '—');
      setText('mdBestAsk', '—');
      setText('mdBookSpread', '—');
      setText('mdBookFoot', 'Depth is aggregated by price level; quantities are contracts. The public feed does not expose maker identities or queue position.');
      return;
    }
    const bids = view.bids || [];
    const asks = view.asks || [];
    const bestBid = bids[0];
    const bestAsk = asks[0];
    setText('mdBookState', view.recorded
      ? 'REPLAY · ' + new Date(view.time).toISOString().slice(11, 23) + ' UTC · update ' + integer(view.lastUpdateId)
      : 'SYNCED · update ' + integer(view.lastUpdateId));
    setText('mdBestBid', bestBid ? number(bestBid.price, 1) : '—');
    setText('mdBestAsk', bestAsk ? number(bestAsk.price, 1) : '—');
    const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : null;
    const spreadText = spread === null ? '—' : number(spread, 2) + ' · ' + number(spread / ((bestAsk.price + bestBid.price) / 2) * 10000, 2) + ' bps';
    setText('mdBookSpread', spreadText);
    setText('mdSpread', spread === null ? '—' : number(spread, 2));
    const changes = view.changes || {};
    const bidChanges = changes.bidChanges || {};
    const askChanges = changes.askChanges || {};
    const askRows = asks.slice(0, 14);
    const bidRows = bids.slice(0, 14);
    const maxQty = Math.max(1, ...askRows.map(level => level.qty), ...bidRows.map(level => level.qty));
    const tbody = $('mdBookRows');
    if (!tbody) return;
    tbody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 14; i++) {
      const bid = bidRows[i];
      const ask = askRows[i];
      const tr = document.createElement('tr');
      const bidQty = cell('', 'md-bid-qty');
      const bidPrice = cell(bid ? number(bid.price, 1) : '', 'md-bid-price');
      const askPrice = cell(ask ? number(ask.price, 1) : '', 'md-ask-price');
      const askQty = cell('', 'md-ask-qty');
      if (bid) {
        const delta = Number(bidChanges[String(Number(bid.price))] || 0);
        const bar = document.createElement('span');
        bar.className = 'md-depth-bar md-bid-depth';
        bar.style.width = (bid.qty / maxQty * 100).toFixed(1) + '%';
        const value = document.createElement('span');
        value.textContent = contractQty(bid.qty);
        bidQty.append(bar, value);
        if (delta !== 0) bidQty.appendChild(levelDelta(delta));
      }
      if (ask) {
        const delta = Number(askChanges[String(Number(ask.price))] || 0);
        const bar = document.createElement('span');
        bar.className = 'md-depth-bar md-ask-depth';
        bar.style.width = (ask.qty / maxQty * 100).toFixed(1) + '%';
        const value = document.createElement('span');
        value.textContent = contractQty(ask.qty);
        askQty.append(bar, value);
        if (delta !== 0) askQty.appendChild(levelDelta(delta));
      }
      tr.append(bidQty, bidPrice, askPrice, askQty);
      fragment.appendChild(tr);
    }
    tbody.appendChild(fragment);
    setText('mdBookFoot', view.recorded
      ? 'RECORDED SNAPSHOT · ' + new Date(view.time).toISOString().replace('T', ' ').slice(0, 23) + ' UTC · connection segment ' + integer(view.segment) + '. Top 25 levels only; snapshots between samples are not reconstructed. Depth is aggregated, and reductions may be executions or cancellations.'
      : 'Top 25 depth: bid ' + contractQty(view.bidDepth) + ' · ask ' + contractQty(view.askDepth) + ' contracts. Latest diff: bids +' + contractQty(changes.bidAdded) + ' / −' + contractQty(changes.bidReduced) + ' · asks +' + contractQty(changes.askAdded) + ' / −' + contractQty(changes.askReduced) + '. Reductions may be executions or cancellations; the feed does not distinguish them.');
  }
  function renderDepthHeatmap() {
    const host = $('mdDepthHeatmap');
    if (!host || !Plotly || typeof Plotly.react !== 'function') return;
    const samples = feed.getDepthHistory(240);
    if (!samples.length) {
      setText('mdHeatmapMeta', 'No captured depth history yet');
      if (Plotly.purge) Plotly.purge(host);
      return;
    }
    const latest = samples[samples.length - 1];
    const midpoint = latest.bids.length && latest.asks.length
      ? (latest.bids[0].price + latest.asks[0].price) / 2
      : (latest.bids[0]?.price || latest.asks[0]?.price || 0);
    const priceSet = new Set();
    for (const sample of samples) {
      for (const level of sample.bids) priceSet.add(Number(level.price));
      for (const level of sample.asks) priceSet.add(Number(level.price));
    }
    const prices = Array.from(priceSet).sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint)).slice(0, 60).sort((a, b) => a - b);
    const x = samples.map(sample => new Date(sample.time));
    const z = prices.map(price => samples.map(sample => {
      const bid = sample.bids.find(level => Number(level.price) === price);
      const ask = sample.asks.find(level => Number(level.price) === price);
      return bid ? Number(bid.qty) : ask ? -Number(ask.qty) : 0;
    }));
    const layout = {
      height: Math.max(150, Math.round(host.getBoundingClientRect().height || 190)),
      paper_bgcolor: '#0c1422', plot_bgcolor: '#0c1422',
      font: { color: '#91a3bb', size: 8 },
      margin: { l: 52, r: 12, t: 3, b: 25 },
      showlegend: false,
      xaxis: { type: 'date', gridcolor: '#203047', tickfont: { size: 8 }, rangeslider: { visible: false } },
      yaxis: { title: 'Price', gridcolor: '#203047', tickfont: { size: 8 }, nticks: 7 },
      shapes: selectedReplayTime ? [{ type: 'line', x0: selectedReplayTime, x1: selectedReplayTime, y0: 0, y1: 1, yref: 'paper', line: { color: '#f3c969', width: 1, dash: 'dot' } }] : [],
      uirevision: 'coinm-depth-heatmap'
    };
    const trace = {
      type: 'heatmap', x, y: prices, z,
      zmid: 0,
      colorscale: [[0, '#ff7e87'], [0.5, '#111b2b'], [1, '#48d6ad']],
      colorbar: { title: { text: 'Contracts', side: 'right' }, thickness: 8, tickfont: { size: 7 } },
      hovertemplate: '%{x|%Y-%m-%d %H:%M:%S UTC}<br>Price %{y:,.1f}<br>Signed resting depth %{z:,.0f} contracts<extra></extra>'
    };
    const pending = Plotly.react(host, [trace], layout, { responsive: true, displaylogo: false, scrollZoom: false });
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    setText('mdHeatmapMeta', integer(samples.length) + ' captured samples · green bids · red asks · top-25 levels');
  }
  function scheduleDepthHeatmap() {
    if (depthHeatmapTimer !== null) return;
    depthHeatmapTimer = setTimeout(() => {
      depthHeatmapTimer = null;
      renderDepthHeatmap();
    }, 650);
  }
  function levelDelta(delta) {
    const el = document.createElement('i');
    el.className = 'md-level-delta ' + (delta > 0 ? 'md-level-up' : 'md-level-down');
    el.textContent = signedContractQty(delta);
    el.title = (delta > 0 ? 'Added ' : 'Reduced ') + contractQty(Math.abs(delta)) + ' contracts since the latest depth diff';
    return el;
  }
  function updateDepthCaptureControls() {
    const info = feed.getDepthHistoryInfo();
    const record = $('mdRecordDepth');
    const slider = $('mdDepthReplay');
    const live = $('mdDepthLive');
    const exportButton = $('mdDepthExport');
    if (record) record.textContent = info.recording ? 'Stop recording' : 'Record depth';
    if (slider) {
      slider.max = String(Math.max(0, info.count - 1));
      slider.disabled = info.count === 0;
      if (!replayingDepth && info.count) slider.value = String(info.count - 1);
    }
    if (live) live.disabled = !replayingDepth;
    if (exportButton) exportButton.disabled = info.count === 0;
    if (replayingDepth) {
      const sample = slider ? feed.getDepthSnapshot(Number(slider.value)) : null;
      setText('mdDepthReplayMeta', sample
        ? 'REPLAY · ' + new Date(sample.time).toISOString().replace('T', ' ').slice(0, 23) + ' UTC'
        : 'Selected replay sample is no longer retained');
    } else {
      setText('mdDepthReplayMeta', info.recording
        ? 'Recording · ' + integer(info.count) + '/' + integer(info.limit) + ' samples'
        : info.count ? integer(info.count) + ' captured · local archive' : 'Not recording · no saved samples');
    }
  }
  function queueTape(items) {
    pendingTape = items || [];
    if (tapeTimer !== null) return;
    tapeTimer = setTimeout(() => {
      tapeTimer = null;
      renderTape(pendingTape);
    }, 250);
  }
  function updateFootprintSelector(minutes) {
    const select = $('mdFootprintMinute');
    if (!select || !Array.isArray(minutes)) return;
    const key = minutes.join(',');
    if (key === footprintOptionKey) return;
    footprintOptionKey = key;
    const keep = selectedFootprintMinute;
    select.replaceChildren();
    const live = document.createElement('option');
    live.value = 'live';
    live.textContent = 'Follow live minute';
    select.appendChild(live);
    for (const minute of minutes.slice().sort((a, b) => b - a)) {
      const option = document.createElement('option');
      option.value = String(minute);
      const footprint = feed.getFootprint(minute);
      const origin = footprint && String(footprint.source || '').includes('Binance REST') ? ' · REST' : ' · session';
      option.textContent = new Date(minute).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' + origin;
      select.appendChild(option);
    }
    if (keep !== 'live' && minutes.includes(Number(keep))) select.value = keep;
    else {
      selectedFootprintMinute = 'live';
      select.value = 'live';
    }
  }
  function queueFootprint(footprint) {
    pendingFootprint = footprint || null;
    if (footprintTimer !== null) return;
    footprintTimer = setTimeout(() => {
      footprintTimer = null;
      if (selectedFootprintMinute === 'live' && selectedReplayTime === null) renderFootprint(pendingFootprint, false);
    }, 350);
  }
  function renderFootprint(footprint, historical = false) {
    const host = $('mdFootprintRows');
    if (!host) return;
    if (!footprint || !footprint.levels || !footprint.levels.length) {
      host.innerHTML = '<tr><td colspan="7" class="md-muted">Waiting for current-minute executions…</td></tr>';
      setText('mdFootprintMeta', historical ? 'Selected session minute · no retained executions' : 'Live session minute · waiting for executions');
      return;
    }
    const rows = footprint.levels;
    const from = Number(footprint.startTime ?? footprint.minute);
    const to = Number(footprint.endTime ?? (footprint.minute + 60000));
    setText('mdFootprintMeta', (historical ? 'HISTORICAL · ' : 'LIVE · ') + selectedFootprintInterval + 'm · UTC ' + utcMinute(from) + '–' + utcMinute(to) + ' · ' + integer(footprint.levelsTotal) + ' levels · ' + contractQty(footprint.totalQty) + ' contracts · imbalance ' + percent(footprint.imbalance) + (footprint.pocPrice !== null ? ' · POC ' + number(footprint.pocPrice, 1) + ' · VA ' + number(footprint.valueAreaLow, 1) + '–' + number(footprint.valueAreaHigh, 1) : ''));
    host.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const level of rows) {
      const tr = document.createElement('tr');
      const delta = Number(level.delta || 0);
      const price = cell(number(level.price, 1), '');
      const buy = cell(contractQty(level.buyTaker), 'md-footprint-buy');
      const sell = cell(contractQty(level.sellTaker), 'md-footprint-sell');
      const deltaCell = cell(signedContractQty(delta), 'md-footprint-delta ' + (delta > 0 ? 'md-positive' : delta < 0 ? 'md-negative' : ''));
      const diagonal = cell(level.diagonalSide ? level.diagonalSide + ' ' + number(level.diagonalRatio, 1) + '×' : '—', level.diagonalSide === 'BUY' ? 'md-positive' : level.diagonalSide === 'SELL' ? 'md-negative' : 'md-muted');
      diagonal.title = '3:1 or greater ratio against the next observed traded price level, not necessarily the immediately adjacent exchange tick. Minimum executed quantity: 1 contract.';
      const count = cell(integer(level.trades), 'md-tape-qty');
      const profileTag = cell(level.isPoc ? 'POC' : level.inValueArea ? 'VA' : '', level.isPoc ? 'md-footprint-poc' : level.inValueArea ? 'md-footprint-va' : '');
      if (level.isPoc || level.inValueArea) {
        profileTag.style.fontSize = '9px';
        profileTag.style.fontWeight = '700';
        profileTag.style.letterSpacing = '.04em';
        profileTag.style.textAlign = 'center';
        profileTag.style.borderRadius = '3px';
        profileTag.style.padding = '1px 4px';
        profileTag.style.color = level.isPoc ? '#f3c969' : '#91a3bb';
        profileTag.style.background = level.isPoc ? 'rgba(243,201,105,.12)' : 'rgba(145,163,187,.08)';
        tr.style.background = level.isPoc ? 'rgba(243,201,105,.045)' : 'rgba(145,163,187,.025)';
      }
      if (delta > 0) tr.className = 'md-footprint-positive';
      else if (delta < 0) tr.className = 'md-footprint-negative';
      if (level.isPoc) tr.classList.add('md-footprint-poc-row');
      else if (level.inValueArea) tr.classList.add('md-footprint-va-row');
      tr.append(price, buy, sell, deltaCell, diagonal, count, profileTag);
      fragment.appendChild(tr);
    }
    host.appendChild(fragment);
    const provenance = (footprint.source || 'live session') + '. Passive maker quantities mirror taker executions.';
    setText('mdFootprintFoot', (historical ? 'Selected past session minute. ' : 'Following current session minute. ') + (footprint.truncated
      ? 'Showing ' + integer(rows.length) + ' nearest levels from ' + integer(footprint.levelsTotal) + '. '
      : 'Showing all ' + integer(rows.length) + ' retained price levels. ') + 'Quantities are executed taker contracts. POC is the highest-volume price; value area expands from POC to 70% of executed volume. Diagonal imbalance compares adjacent traded price levels at 3:1 or greater, not a fixed tick-size ladder. ' + provenance);
  }
  function renderTape(items) {
    recentTrades = items || [];
    const host = $('mdTape');
    if (!host) return;
    host.innerHTML = '';
    if (!recentTrades.length) {
      host.innerHTML = '<div class="md-empty">Waiting for aggregate trades…</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const trade of recentTrades.slice(0, 30)) {
      const row = document.createElement('div');
      row.className = 'md-tape-row';
      const time = cell(utcTime(trade.time), 'md-tape-time', 'span');
      const price = cell(number(trade.price, 1), trade.takerSide === 'BUY' ? 'md-positive' : 'md-negative', 'span');
      const qty = cell(contractQty(trade.qty), 'md-tape-qty', 'span');
      const sides = document.createElement('span');
      sides.className = 'md-tape-sides';
      const taker = document.createElement('b');
      taker.className = 'md-side-tag ' + (trade.takerSide === 'BUY' ? 'md-tag-buy' : 'md-tag-sell');
      taker.textContent = trade.takerSide + ' TAKER';
      const maker = document.createElement('b');
      maker.className = 'md-side-tag ' + (trade.makerSide === 'BUY' ? 'md-tag-maker-buy' : 'md-tag-maker-sell');
      maker.textContent = trade.makerSide + ' MAKER';
      sides.append(taker, maker);
      row.append(time, price, qty, sides);
      fragment.appendChild(row);
    }
    host.appendChild(fragment);
  }
  function queueDepthArchiveSample(sample) {
    pendingArchiveSamples.push(sample);
    if (archiveFlushTimer !== null) return;
    archiveFlushTimer = setTimeout(() => {
      archiveFlushTimer = null;
      const batch = pendingArchiveSamples.splice(0);
      if (!batch.length) return;
      archiveWrite = archiveWrite.then(() => depthArchive.append(batch, 'BTCUSD_PERP'))
        .catch(error => setText('mdBookFoot', 'Local depth archive write failed: ' + String(error && error.message || error)));
    }, 750);
  }
  const feed = createCoinMMarketFeed({
    symbol: 'BTCUSD_PERP',
    maxDepthSamples: 10000,
    depthSampleIntervalMs: 100,
    onStatus: event => {
      if (event.state === 'connecting') {
        replayingDepth = false;
        selectedReplayTime = null;
        persistedDepthCount = 0;
        latestBookView = null;
        restoreDepthArchive();
        selectedFootprintMinute = 'live';
        footprintOptionKey = null;
        updateFootprintSelector([]);
        renderFootprint(null, false);
        queueBook({ ready: false });
        updateDepthCaptureControls();
      }
      setStatus(event.state, event.message);
    },
    onCandles: event => {
      if (event.interval !== interval) return;
      lastCandlesInterval = event.interval;
      candleHistoryHasMore = event.candles.length >= 1000;
      const local = event.interval === '10s' ? imported('10s') : [];
      setCandleData(mergeCandles(local, event.candles || []), event.source + (local.length ? ' + imported historical COIN-M trades' : local.incompatibleReason ? ' · ' + local.incompatibleReason : ''));
    },
    onKline: (candle, tf) => {
      if (tf !== interval) return;
      lastMarketAt = Date.now();
      lastCandlesInterval = tf;
      candles = mergeCandles(candles, [candle]);
      source = 'Binance COIN-M REST klines + live kline stream';
      setText('mdSource', source);
      scheduleDraw();
    },
    onTrade: (trade, state) => {
      lastMarketAt = Date.now();
      updateStats(state.stats);
      queueTape(state.recentTrades);
      if (state.footprintMinutes) updateFootprintSelector(state.footprintMinutes);
      if (selectedFootprintMinute === 'live' && selectedReplayTime === null) queueFootprint(feed.getFootprintWindow(state.footprint.minute, selectedFootprintInterval));
      if (SECOND_INTERVALS.includes(interval) && state.candle) {
        lastCandlesInterval = interval;
        candles = mergeCandles(candles, [state.candle]);
        source = 'Live aggregate trades since connection' + (interval === '10s' && imported('10s').length ? ' + imported historical trades' : '');
        setText('mdSource', source);
        scheduleDraw();
      }
    },
    onBook: view => {
      latestBookView = view;
      if (view && view.ready) lastMarketAt = Date.now();
      if (!replayingDepth) queueBook(view);
      updateDepthCaptureControls();
      scheduleDepthHeatmap();
      const info = feed.getDepthHistoryInfo();
      if (info.recording && info.count > persistedDepthCount) {
        const sample = feed.getDepthSnapshot(info.count - 1);
        if (sample) {
          persistedDepthCount = info.count;
          queueDepthArchiveSample(sample);
        }
      }
    }
  });
  async function restoreDepthArchive() {
    try {
      const samples = await depthArchive.load({ symbol: 'BTCUSD_PERP', limit: 10000 });
      if (!samples.length) return;
      const info = feed.restoreDepthHistory(samples);
      persistedDepthCount = info.count;
      updateDepthCaptureControls();
      renderDepthHeatmap();
      setText('mdBookFoot', 'Restored ' + integer(info.count) + ' historical depth snapshots from this browser. Start replay with the slider. Archive is local to this device.');
    } catch (error) {
      setText('mdBookFoot', 'Could not restore local depth archive: ' + String(error && error.message || error));
    }
  }
  restoreDepthArchive();
  function showImportedInterval(tf) {
    const local = tf === '10s' ? imported('10s') : [];
    if (tf === '10s' && local.length) setCandleData(local, 'Imported historical COIN-M archive · 10-second candles');
    else if (tf === '10s' && local.incompatibleReason) setCandleData([], local.incompatibleReason);
    else if (SECOND_INTERVALS.includes(tf)) setCandleData([], 'Live session only · Binance COIN-M has no historical ' + tf + ' kline endpoint');
  }
  async function chooseInterval(tf) {
    if (!MARKET_INTERVALS.some(item => item.value === tf)) return;
    interval = tf;
    intervalSelect.value = tf;
    candleHistoryHasMore = false;
    loadingOlderCandles = false;
    updateCandleHistoryControls();
    setText('mdCandleMeta', 'Loading ' + intervalLabel(tf) + ' candles…');
    if (SECOND_INTERVALS.includes(tf)) showImportedInterval(tf);
    if (!connected) {
      if (!SECOND_INTERVALS.includes(tf)) setCandleData([], 'Connect live to load Binance COIN-M ' + tf + ' candles');
      return;
    }
    lastCandlesInterval = null;
    try {
      await feed.setInterval(tf);
      if (interval !== tf) return;
      if (lastCandlesInterval !== tf) {
        if (SECOND_INTERVALS.includes(tf)) showImportedInterval(tf);
        else setCandleData([], 'No ' + intervalLabel(tf) + ' candles were returned. The live stream may still connect.');
      }
    } catch (error) {
      setText('mdCandleMeta', 'Interval change failed: ' + String(error && error.message || error));
    }
  }
  $('mdConnect').addEventListener('click', async () => {
    if (connected) {
      feed.disconnect();
      return;
    }
    const button = $('mdConnect');
    button.disabled = true;
    lastMarketAt = null;
    updateFreshness();
    try {
      await feed.connect(interval);
    } catch (error) {
      setStatus('error', 'Could not connect to Binance COIN-M market data: ' + String(error && error.message || error));
    } finally {
      button.disabled = false;
    }
  });
  intervalSelect.addEventListener('change', () => chooseInterval(intervalSelect.value));
  $('mdLoadOlder').addEventListener('click', async () => {
    if (loadingOlderCandles || !candleHistoryHasMore || !candles.length || candles.length >= 5000 || SECOND_INTERVALS.includes(interval)) return;
    const tf = interval;
    const before = Number(candles[0].t);
    loadingOlderCandles = true;
    updateCandleHistoryControls();
    try {
      const older = await feed.loadOlderKlines(tf, before, 1000);
      if (interval !== tf) return;
      if (!older.length) candleHistoryHasMore = false;
      else {
        candles = mergeCandles(older, candles);
        candleHistoryHasMore = older.length >= 1000 && candles.length < 5000;
        setCandleData(candles, 'Binance COIN-M REST klines + live kline updates · paginated history');
      }
      setText('mdCandleMeta', older.length
        ? integer(older.length) + ' older candles added · ' + integer(candles.length) + ' retained'
        : 'No older candles returned by Binance for this interval');
    } catch (error) {
      setText('mdCandleMeta', 'Could not load older candles: ' + String(error && error.message || error));
    } finally {
      loadingOlderCandles = false;
      updateCandleHistoryControls();
    }
  });
  $('mdBackfillFootprint').addEventListener('click', async () => {
    const button = $('mdBackfillFootprint');
    const previousSelection = selectedFootprintMinute;
    button.disabled = true;
    button.textContent = 'Backfilling…';
    const minutes = Math.min(240, Math.max(60, Number($('mdFootprintRange').value) || 60));
    button.textContent = 'Backfilling…';
    setText('mdFootprintFoot', 'Fetching Binance COIN-M aggregate trades for the previous ' + minutes + ' minutes. The request is bounded by 100 pages and 100,000 trades.');
    try {
      const result = await feed.backfillFootprintHistory({ minutes, maxMinutes: 240, maxPages: 100, maxTrades: 100000 });
      updateFootprintSelector(result.minutes);
      if (result.minutes.length) {
        selectedFootprintMinute = String(result.minutes[result.minutes.length - 1]);
        $('mdFootprintMinute').value = selectedFootprintMinute;
        renderFootprint(feed.getFootprintWindow(Number(selectedFootprintMinute), selectedFootprintInterval), true);
      }
      setText('mdFootprintFoot', 'Binance REST backfill · ' + integer(result.tradesCount) + ' aggregate trades across ' + integer(result.pages) + ' requests and ' + integer(result.minutes.length) + ' UTC minutes. ' + (result.truncated ? 'Result is incomplete because the safety cap was reached. ' : 'Requested interval was retrieved. ') + 'Only Binance-reported market aggregate trades are included; passive maker quantities mirror taker executions.');
    } catch (error) {
      selectedFootprintMinute = previousSelection;
      setText('mdFootprintFoot', 'Historical backfill failed: ' + String(error && error.message || error));
    } finally {
      button.disabled = false;
      button.textContent = 'Backfill';
    }
  });
  $('mdFootprintTf').addEventListener('change', () => {
    selectedFootprintInterval = Math.max(1, Math.min(15, Number($('mdFootprintTf').value) || 1));
    const end = selectedFootprintMinute === 'live' ? feed.getLatestFootprint()?.minute : Number(selectedFootprintMinute);
    renderFootprint(end ? feed.getFootprintWindow(end, selectedFootprintInterval) : null, selectedFootprintMinute !== 'live');
  });
  $('mdFootprintMinute').addEventListener('change', () => {
    selectedFootprintMinute = $('mdFootprintMinute').value;
    if (selectedFootprintMinute !== 'live') {
      selectedReplayTime = Number(selectedFootprintMinute);
      const nearest = feed.getDepthSnapshotIndexAt(selectedReplayTime, 60000);
      if (nearest >= 0) { $('mdDepthReplay').value = String(nearest); replayingDepth = true; const sample = feed.getDepthSnapshot(nearest); if (sample) renderBook({ ...sample, ready: true, recorded: true }); }
      updateDepthCaptureControls();
      scheduleDraw(); renderDepthHeatmap();
    } else {
      selectedReplayTime = null;
      replayingDepth = false;
      if (latestBookView) renderBook(latestBookView);
      updateDepthCaptureControls();
      scheduleDraw(); renderDepthHeatmap();
    }
    if (selectedFootprintMinute === 'live') {
      const latest = feed.getLatestFootprint();
      renderFootprint(latest ? feed.getFootprintWindow(latest.minute, selectedFootprintInterval) : null, false);
    } else renderFootprint(feed.getFootprintWindow(Number(selectedFootprintMinute), selectedFootprintInterval), true);
  });
  $('mdRecordDepth').addEventListener('click', () => {
    feed.setDepthRecording(!feed.getDepthRecording());
    const info = feed.getDepthHistoryInfo();
    if (info.recording && info.count > persistedDepthCount) {
      const sample = feed.getDepthSnapshot(info.count - 1);
      if (sample) {
        persistedDepthCount = info.count;
        queueDepthArchiveSample(sample);
      }
    }
    updateDepthCaptureControls();
  });
  $('mdDepthReplay').addEventListener('input', () => {
    const sample = feed.getDepthSnapshot(Number($('mdDepthReplay').value));
    if (!sample) return;
    replayingDepth = true;
    selectedReplayTime = sample.time;
    renderBook({ ...sample, ready: true, recorded: true });
    const footprintMinute = Math.floor(sample.time / 60000) * 60000;
    if (feed.getFootprintMinutes().includes(footprintMinute)) {
      selectedFootprintMinute = String(footprintMinute);
      $('mdFootprintMinute').value = selectedFootprintMinute;
      renderFootprint(feed.getFootprintWindow(footprintMinute, selectedFootprintInterval), true);
    } else {
      selectedFootprintMinute = 'live';
      $('mdFootprintMinute').value = 'live';
      renderFootprint(null, true);
      setText('mdFootprintMeta', 'NO FOOTPRINT DATA · UTC ' + utcMinute(footprintMinute));
    }
    scheduleDraw();
    renderDepthHeatmap();
    setText('mdDepthReplayMeta', 'REPLAY · ' + new Date(sample.time).toISOString().replace('T', ' ').slice(0, 23) + ' UTC · segment ' + integer(sample.segment));
    updateDepthCaptureControls();
  });
  $('mdDepthLive').addEventListener('click', () => {
    replayingDepth = false;
    selectedReplayTime = null;
    selectedFootprintMinute = 'live';
    $('mdFootprintMinute').value = 'live';
    const latestFootprint = feed.getLatestFootprint();
    if (latestFootprint) renderFootprint(feed.getFootprintWindow(latestFootprint.minute, selectedFootprintInterval), false);
    if (latestBookView) renderBook(latestBookView);
    scheduleDraw();
    renderDepthHeatmap();
    updateDepthCaptureControls();
  });
  $('mdDepthImport').addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new RangeError('Depth capture import is limited to 20 MB.');
      const payload = JSON.parse(await file.text());
      if (!payload || payload.schema !== 'BTCUSD-Market-Mechanics-Lab-COINM-depth-v1' ||
          payload.symbol !== 'BTCUSD_PERP' || payload.quantityUnit !== 'contracts' ||
          !Array.isArray(payload.samples)) {
        throw new TypeError('Unsupported capture. Import a BTCUSD_PERP COIN-M depth JSON exported by this workstation.');
      }
      const info = feed.restoreDepthHistory(payload.samples);
      await depthArchive.append(payload.samples, 'BTCUSD_PERP');
      persistedDepthCount = info.count;
      replayingDepth = false;
      updateDepthCaptureControls();
      if (info.count) {
        const slider = $('mdDepthReplay');
        slider.value = String(info.count - 1);
        const sample = feed.getDepthSnapshot(info.count - 1);
        replayingDepth = true;
        renderBook({ ...sample, ready: true, recorded: true });
        selectedReplayTime = sample.time;
        renderDepthHeatmap();
        updateDepthCaptureControls();
      }
      setText('mdBookFoot', 'Imported ' + integer(payload.samples.length) + ' recorded snapshots. Replay uses captured top-25 price levels only; gaps between samples are not reconstructed.');
    } catch (error) {
      setText('mdBookFoot', 'Depth import failed: ' + String(error && error.message || error));
    } finally {
      input.value = '';
    }
  });
  $('mdDepthExport').addEventListener('click', () => {
    const samples = feed.getDepthHistory();
    if (!samples.length) return;
    const payload = {
      schema: 'BTCUSD-Market-Mechanics-Lab-COINM-depth-v1',
      symbol: 'BTCUSD_PERP',
      quantityUnit: 'contracts',
      capture: 'Browser-session top-25 price-level snapshots only; no individual order IDs or queue positions.',
      samples
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'BTCUSD_PERP-depth-capture-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const resize = () => {
    if (resizeTimer !== null) return;
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!root.getBoundingClientRect().width) return;
      if (candles.length) scheduleDraw();
      if (pendingDraw) scheduleDraw();
    }, 180);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(root);
  if (typeof window !== 'undefined') window.addEventListener('resize', resize, { passive: true });
  if (typeof setInterval === 'function') freshTimer = setInterval(updateFreshness, 1000);
  updateFreshness();
  return {
    activate() {
      resize();
      if (pendingDraw || candles.length) scheduleDraw();
    },
    getInterval() { return interval; },
    getState() { return feedState; },
    syncImportedBars() {
      if (interval === '10s' && !connected) showImportedInterval('10s');
    },
    setInterval: chooseInterval
  };
}
