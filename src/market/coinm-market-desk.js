import { MARKET_INTERVALS, SECOND_INTERVALS, COINM_CONTRACT_USD, createCoinMMarketFeed, replayDepthRecording } from './coinm-market-data.js';

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
        '<div class="md-controls"><label for="mdInterval">Candle timeframe<select id="mdInterval"></select></label><button class="btn" id="mdLoadOlder" type="button" disabled>Load older candles</button><button class="btn primary" id="mdConnect" type="button" aria-pressed="false">Connect live</button></div>',
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
          '<section class="md-panel md-panel-grow"><div class="md-panel-head"><div><strong>Exchange candlesticks</strong><small id="mdCandleMeta">Waiting for market data</small></div><span class="md-unit">contracts</span></div><div class="md-chart-wrap"><div id="mdCandles" class="md-candles" aria-label="Live Binance COIN-M candlestick chart"></div><div id="mdCandleEmpty" class="md-empty md-overlay">Connect live to load historical Binance COIN-M candles.</div></div></section>',
          '<section class="md-panel md-flow-panel"><div class="md-panel-head"><div><strong>Executed volume by aggressor</strong><small>Green = BUY TAKER / SELL MAKER · Red = SELL TAKER / BUY MAKER</small></div><span class="md-unit">contracts</span></div><div class="md-flow-wrap"><div id="mdFlow" class="md-flow" aria-label="Executed volume by aggressor"></div></div></section>',
        '</div>',
        '<div class="md-col md-flow-column">',
          '<section class="md-panel md-panel-grow md-footprint-panel"><div class="md-panel-head"><div><strong>Per-price execution footprint</strong><small id="mdFootprintMeta">Live current UTC minute · select a candle for historical trades</small></div><span class="md-unit">contracts</span></div><div class="md-panel-actions"><button class="btn" id="mdInspectFootprint" type="button" disabled>Inspect selected candle</button><small id="mdFootprintSelection">Click a candlestick to select its interval</small></div><div class="md-footprint-legend"><span>BUY TAKER / SELL MAKER</span><span>SELL TAKER / BUY MAKER</span><span>Delta = buy − sell</span></div><div class="md-table-wrap"><table class="md-footprint"><thead><tr><th>Price</th><th>Buy taker<br><small>Sell maker</small></th><th>Sell taker<br><small>Buy maker</small></th><th>Delta</th><th>Prints</th></tr></thead><tbody id="mdFootprintRows"><tr><td colspan="5" class="md-muted">Connect live to collect current-minute executions by price.</td></tr></tbody></table></div><div class="md-panel-foot" id="mdFootprintFoot">Live footprint resets each UTC minute. Select an exchange candle to reconstruct its footprint from historical aggregate trades.</div></section>',
        '</div>',
        '<div class="md-col md-side-column">',
          '<section class="md-panel md-panel-grow md-book-panel"><div class="md-panel-head"><div><strong>Live order book</strong><small id="mdBookState">Not synchronized</small></div><span class="md-unit">contracts</span></div><div class="md-book-summary"><span>Bid <b id="mdBestBid">—</b></span><span>Spread <b id="mdBookSpread">—</b></span><span>Ask <b id="mdBestAsk">—</b></span></div><div class="md-table-wrap"><table class="md-book"><thead><tr><th>Bid qty</th><th>Bid price</th><th>Ask price</th><th>Ask qty</th></tr></thead><tbody id="mdBookRows"><tr><td colspan="4" class="md-muted">Connect to synchronize depth.</td></tr></tbody></table></div><div class="md-panel-actions"><button class="btn" id="mdSaveDepth" type="button" disabled>Download depth capture</button><label>Replay time <input id="mdReplayTime" type="range" min="0" max="0" value="0" disabled></label><button class="btn" id="mdReplayDepth" type="button" disabled>Replay</button></div><div class="md-panel-foot" id="mdBookFoot">Depth is aggregated by price. A session recording can be downloaded and replayed; individual maker identities and queue position are unavailable.</div></section>',
          '<section class="md-panel md-tape-panel"><div class="md-panel-head"><div><strong>Live trade tape</strong><small id="mdTapeMeta">Waiting for aggregate trades</small></div><span class="md-unit">contracts</span></div><div class="md-tape-head"><span>UTC</span><span>Price</span><span>Qty</span><span>Aggressor → passive</span></div><div id="mdTape" class="md-tape"><div class="md-empty">Waiting for aggregate trades…</div></div></section>',
        '</div>',
      '</div>',
      '<details class="md-footnote"><summary>Data semantics and limits</summary><p><b>COIN-M contract units:</b> kline volume, aggregate-trade quantity and depth quantity are contracts. BTCUSD_PERP uses 100 USD face value per contract; the interface never relabels contracts as BTC or USD notional. Binance aggregate trades expose whether the buyer was maker: buyer maker = false is BUY TAKER / SELL MAKER, buyer maker = true is SELL TAKER / BUY MAKER. Both sides are mirrored views of one execution, never additional volume. Candles from 1m upward are exchange klines; seconds candles are built only from executions observed in this session and are not historical reconstructions. Public depth is aggregated by price and does not expose maker identities or queue position. The session can record sequenced snapshots and diffs for replay; Binance does not provide a public historical depth archive. Quantity reductions can be executions or cancellations.</p></details>',
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
  let selectedCandle = null;
  let replayMode = false;

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
    return Array.from(map.values()).sort((x, y) => x.t - y.t).slice(-20000);
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
    const visible = candles.slice(-3000);
    if (!candleEl.__coinmClickBound && typeof candleEl.on === 'function') {
      candleEl.on('plotly_click', event => {
        const point = event && event.points && event.points[0];
        const index = point && Number(point.pointNumber);
        const currentVisible = candles.slice(-3000);
        if (!Number.isInteger(index) || index < 0 || index >= currentVisible.length) return;
        selectedCandle = currentVisible[index];
        const button = $('mdInspectFootprint');
        if (button) button.disabled = false;
        setText('mdFootprintSelection', 'Selected candle: ' + new Date(selectedCandle.t).toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
      });
      candleEl.__coinmClickBound = true;
    }
    if (!visible.length) {
      setVisible('mdCandleEmpty', true);
      setText('mdCandleMeta', 'No candles for this interval yet');
      if (Plotly && Plotly.purge) {
        try { Plotly.purge(candleEl); Plotly.purge($('mdFlow')); } catch (_) {}
      }
      return;
    }
    setVisible('mdCandleEmpty', false);
    setText('mdCandleMeta', integer(visible.length) + ' candles shown' + (candles.length > visible.length ? ' · latest ' + integer(visible.length) + ' of ' + integer(candles.length) : ''));
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
  function setCandleData(next, nextSource) {
    candles = Array.isArray(next) ? next.slice() : [];
    source = nextSource || '';
    setText('mdSource', source);
    setVisible('mdCandleEmpty', candles.length === 0);
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
      renderBook(pendingBook);
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
    setText('mdBookState', (replayMode ? 'REPLAY · ' : 'SYNCED · ') + 'update ' + integer(view.lastUpdateId));
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
    setText('mdBookFoot', 'Top 25 depth: bid ' + contractQty(view.bidDepth) + ' · ask ' + contractQty(view.askDepth) + ' contracts. Latest diff: bids +' + contractQty(changes.bidAdded) + ' / −' + contractQty(changes.bidReduced) + ' · asks +' + contractQty(changes.askAdded) + ' / −' + contractQty(changes.askReduced) + '. Reductions may be executions or cancellations; the feed does not distinguish them.');
  }
  function levelDelta(delta) {
    const el = document.createElement('i');
    el.className = 'md-level-delta ' + (delta > 0 ? 'md-level-up' : 'md-level-down');
    el.textContent = signedContractQty(delta);
    el.title = (delta > 0 ? 'Added ' : 'Reduced ') + contractQty(Math.abs(delta)) + ' contracts since the latest depth diff';
    return el;
  }
  function queueTape(items) {
    pendingTape = items || [];
    if (tapeTimer !== null) return;
    tapeTimer = setTimeout(() => {
      tapeTimer = null;
      renderTape(pendingTape);
    }, 250);
  }
  function queueFootprint(footprint) {
    pendingFootprint = footprint || null;
    if (footprintTimer !== null) return;
    footprintTimer = setTimeout(() => {
      footprintTimer = null;
      renderFootprint(pendingFootprint);
    }, 350);
  }
  function renderFootprint(footprint) {
    const host = $('mdFootprintRows');
    if (!host) return;
    if (!footprint || !footprint.levels || !footprint.levels.length) {
      host.innerHTML = '<tr><td colspan="5" class="md-muted">Waiting for current-minute executions…</td></tr>';
      setText('mdFootprintMeta', 'Current UTC minute · waiting for executions');
      return;
    }
    const rows = footprint.levels;
    setText('mdFootprintMeta', footprint.historical ? 'Historical selected candle · ' + integer(footprint.tradesCount || 0) + ' aggregate trades · ' + integer(footprint.pages || 0) + ' REST pages' : 'Live UTC ' + utcMinute(footprint.minute) + '–' + utcMinute(footprint.minute + 60000) + ' · ' + integer(footprint.levelsTotal) + ' levels · ' + contractQty(footprint.totalQty) + ' contracts · imbalance ' + percent(footprint.imbalance));
    host.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const level of rows) {
      const tr = document.createElement('tr');
      const delta = Number(level.delta || 0);
      const price = cell(number(level.price, 1), '');
      const buy = cell(contractQty(level.buyTaker), 'md-footprint-buy');
      const sell = cell(contractQty(level.sellTaker), 'md-footprint-sell');
      const deltaCell = cell(signedContractQty(delta), 'md-footprint-delta ' + (delta > 0 ? 'md-positive' : delta < 0 ? 'md-negative' : ''));
      const count = cell(integer(level.trades), 'md-tape-qty');
      if (delta > 0) tr.className = 'md-footprint-positive';
      else if (delta < 0) tr.className = 'md-footprint-negative';
      tr.append(price, buy, sell, deltaCell, count);
      fragment.appendChild(tr);
    }
    host.appendChild(fragment);
    setText('mdFootprintFoot', (footprint.historical ? 'Historical Binance aggregate trades for the selected candle. ' : 'Live footprint for the current UTC minute. ') + (footprint.truncated ? 'Showing ' + integer(rows.length) + ' of ' + integer(footprint.levelsTotal) + ' price levels. ' : 'All ' + integer(rows.length) + ' price levels shown. ') + 'Quantities are executed taker contracts; passive maker quantities mirror the same executions and are not added again.' + (footprint.pagesTruncated ? ' Historical retrieval reached its page cap; this footprint is incomplete.' : '');
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
  const feed = createCoinMMarketFeed({
    symbol: 'BTCUSD_PERP',
    onStatus: event => setStatus(event.state, event.message),
    onCandles: event => {
      if (event.interval !== interval) return;
      $('mdLoadOlder').disabled = SECOND_INTERVALS.includes(interval) || !event.candles || !event.candles.length;
      lastCandlesInterval = event.interval;
      const local = event.interval === '10s' ? imported('10s') : [];
      setCandleData(mergeCandles(local, event.candles || []), event.source + (local.length ? ' + imported historical COIN-M trades' : local.incompatibleReason ? ' · ' + local.incompatibleReason : ''));
    },
    onKline: (candle, tf) => {
      if (tf !== interval) return;
      $('mdLoadOlder').disabled = false;
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
      queueFootprint(state.footprint);
      if (SECOND_INTERVALS.includes(interval) && state.candle) {
        lastCandlesInterval = interval;
        candles = mergeCandles(candles, [state.candle]);
        source = 'Live aggregate trades since connection' + (interval === '10s' && imported('10s').length ? ' + imported historical trades' : '');
        setText('mdSource', source);
        scheduleDraw();
      }
    },
    onBook: view => {
      if (view && view.ready) lastMarketAt = Date.now();
      replayMode = false;
      const recording = feed.getDepthRecording();
      const slider = $('mdReplayTime'), save = $('mdSaveDepth'), replay = $('mdReplayDepth');
      if (recording.snapshots.length && slider) {
        const first = recording.snapshots[0].capturedAt;
        const last = recording.events.length ? recording.events[recording.events.length - 1].capturedAt : first;
        slider.min = String(first); slider.max = String(Math.max(first, last));
        if (!slider.value || Number(slider.value) < first || Number(slider.value) > last) slider.value = String(last);
        slider.disabled = false;
        if (save) save.disabled = false;
        if (replay) replay.disabled = false;
      }
      queueBook(view);
    }
  });
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
    setText('mdCandleMeta', 'Loading ' + intervalLabel(tf) + ' candles…');
    if (SECOND_INTERVALS.includes(tf)) showImportedInterval(tf);
    $('mdLoadOlder').hidden = SECOND_INTERVALS.includes(tf);
    $('mdLoadOlder').disabled = !connected || SECOND_INTERVALS.includes(tf) || !candles.length;
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
    if (!connected || SECOND_INTERVALS.includes(interval) || !candles.length) return;
    const button = $('mdLoadOlder'), tf = interval, before = Number(candles[0].t);
    button.disabled = true; button.textContent = 'Loading…';
    try {
      const older = await feed.loadOlderKlines(tf, before, 1000);
      if (interval !== tf) return;
      if (!older.length) { button.textContent = 'No older candles'; return; }
      candles = mergeCandles(older, candles);
      setText('mdCandleMeta', integer(candles.length) + ' candles loaded · ' + integer(older.length) + ' older');
      scheduleDraw(); button.textContent = 'Load older candles';
    } catch (error) {
      setText('mdCandleMeta', 'Older candle load failed: ' + String(error && error.message || error));
      button.textContent = 'Retry older candles';
    } finally {
      if (interval === tf && button.textContent !== 'No older candles') button.disabled = false;
    }
  });
  $('mdInspectFootprint').addEventListener('click', async () => {
    if (!selectedCandle) return;
    const button = $('mdInspectFootprint'), tf = interval, candle = selectedCandle;
    let end = Number(candle.closeTime) + 1;
    if (!Number.isFinite(end) || end <= Number(candle.t)) {
      const duration = { '1s':1000, '5s':5000, '10s':10000, '15s':15000, '30s':30000, '1m':60000, '3m':180000, '5m':300000, '15m':900000, '30m':1800000, '1h':3600000, '2h':7200000, '4h':14400000, '6h':21600000, '8h':28800000, '12h':43200000, '1d':86400000, '3d':259200000, '1w':604800000 }[tf];
      end = duration ? Number(candle.t) + duration : new Date(Date.UTC(new Date(candle.t).getUTCFullYear(), new Date(candle.t).getUTCMonth() + 1, 1)).getTime();
    }
    button.disabled = true; button.textContent = 'Loading trades…';
    setText('mdFootprintSelection', 'Fetching historical aggregate trades for selected candle…');
    try {
      const footprint = await feed.loadHistoricalFootprint(Number(candle.t), end, { maxPages: 20, maxTrades: 20000 });
      if (interval !== tf || selectedCandle !== candle) return;
      queueFootprint(footprint);
      setText('mdFootprintSelection', integer(footprint.tradesCount) + ' trades across ' + integer(footprint.pages) + ' pages');
    } catch (error) {
      setText('mdFootprintSelection', 'Historical footprint failed: ' + String(error && error.message || error));
    } finally {
      button.disabled = !selectedCandle; button.textContent = 'Inspect selected candle';
    }
  });
  $('mdSaveDepth').addEventListener('click', () => {
    const recording = feed.getDepthRecording();
    if (!recording.snapshots.length) return;
    const blob = new Blob([JSON.stringify(recording)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'BTCUSD_PERP-depth-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('mdReplayDepth').addEventListener('click', () => {
    const recording = feed.getDepthRecording(), at = Number($('mdReplayTime').value);
    const view = replayDepthRecording(recording, at);
    replayMode = true;
    if (!view.ready) { setText('mdBookState', 'Replay unavailable · ' + view.reason); return; }
    renderBook(view);
    setText('mdBookFoot', 'REPLAY · recorded local session depth at ' + new Date(at).toISOString() + '. Sequence-valid from the latest preceding snapshot. Not historical Binance archive data.');
  });
  $('mdReplayTime').addEventListener('input', () => { replayMode = false; });
  $('mdLoadOlder').hidden = false;
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
      replayMode = false;
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
