import { MARKET_INTERVALS, createCoinMMarketFeed } from './coinm-market-data.js';

const number = (value,digits=2) => Number(value||0).toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:0});
const utcTime = ms => new Date(ms).toISOString().slice(11,23);
const intervalLabel = value => (MARKET_INTERVALS.find(x=>x.value===value)||{label:value}).label;

export function mountCoinMMarketDesk({root,Plotly=window.Plotly,getImportedBars=()=>[]}={}) {
  if (!root) return {activate(){},syncImportedBars(){},getInterval(){return null;}};
  root.innerHTML = [
    '<div class="md-root">',
      '<div class="md-topbar">',
        '<div class="md-title"><div class="md-kicker">BINANCE COIN-M · BTCUSD PERPETUAL</div><strong>Live candles + execution flow + order book</strong><small>Exchange OHLC · aggregate trades · synchronized public depth</small></div>',
        '<div class="md-controls"><label for="mdInterval">Candle timeframe<select id="mdInterval"></select></label><button class="btn primary" id="mdConnect" type="button">Connect live</button></div>',
      '</div>',
      '<div class="md-statusline"><span id="mdState" class="md-state">DISCONNECTED</span><span id="mdDetail">Connect to load the latest 500 exchange candles and live market data.</span><span id="mdSource">No candle source</span></div>',
      '<div class="md-metrics">',
        '<div><span>Last trade</span><strong id="mdPrice">—</strong><small>COIN-M contract price</small></div>',
        '<div><span>BUY TAKER · SELL MAKER</span><strong id="mdBuyTaker">—</strong><small>Since live connection</small></div>',
        '<div><span>SELL TAKER · BUY MAKER</span><strong id="mdSellTaker">—</strong><small>Since live connection</small></div>',
        '<div><span>Net taker delta</span><strong id="mdDelta">—</strong><small>Buy taker − sell taker</small></div>',
        '<div><span>Best spread</span><strong id="mdSpread">—</strong><small>Best ask − best bid</small></div>',
      '</div>',
      '<div class="md-layout">',
        '<div class="md-chart-column">',
          '<section class="md-panel"><div class="md-panel-head"><strong>Exchange candlesticks</strong><span id="mdCandleMeta">Waiting for market data</span></div><div id="mdCandles" class="md-candles"></div><div id="mdCandleEmpty" class="md-empty">Connect live to load historical Binance COIN-M candles.</div></section>',
          '<section class="md-panel"><div class="md-panel-head"><strong>Executed volume by aggressor</strong><span>Green = BUY TAKER / SELL MAKER · Red = SELL TAKER / BUY MAKER</span></div><div id="mdFlow" class="md-flow"></div></section>',
        '</div>',
        '<div class="md-side-column">',
          '<section class="md-panel md-book-panel"><div class="md-panel-head"><strong>Live order book</strong><span id="mdBookState">Not synchronized</span></div><div class="md-book-summary"><span>Bid <b id="mdBestBid">—</b></span><span>Spread <b id="mdBookSpread">—</b></span><span>Ask <b id="mdBestAsk">—</b></span></div><div class="md-book-wrap"><table class="md-book"><thead><tr><th>Bid qty</th><th>Bid price</th><th>Ask price</th><th>Ask qty</th></tr></thead><tbody id="mdBookRows"><tr><td colspan="4" class="md-muted">Connect to synchronize depth.</td></tr></tbody></table></div><div class="md-book-foot" id="mdBookFoot">Depth is aggregated by price level, not individual order IDs.</div></section>',
          '<section class="md-panel md-tape-panel"><div class="md-panel-head"><strong>Live trade tape</strong><span>Each print shows both sides</span></div><div class="md-tape-head"><span>UTC</span><span>Price</span><span>Qty</span><span>Aggressor → passive</span></div><div id="mdTape" class="md-tape"><div class="md-empty">Waiting for aggregate trades…</div></div></section>',
        '</div>',
      '</div>',
      '<div class="md-footnote"><b>Data semantics:</b> Binance COIN-M aggregate trades expose whether the buyer was maker. BUY TAKER is simultaneously SELL MAKER; SELL TAKER is simultaneously BUY MAKER. Counterparty quantities are mirrored, not additional volume. Public depth shows resting quantity aggregated at each price. It does not expose individual maker identities, queue position or historical order-book replay. Seconds candles are built from trades observed during this live session; exchange kline history begins at 1 minute.</div>',
    '</div>'
  ].join('');

  const $ = id => root.querySelector('#'+id);
  const intervalSelect = $('mdInterval');
  for (const item of MARKET_INTERVALS) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label + (item.value.endsWith('s') ? ' · live' : '');
    intervalSelect.appendChild(option);
  }
  intervalSelect.value = '1m';

  let interval='1m',connected=false,candles=[],source='',recentTrades=[],renderTimer=null,pendingDraw=false,tapeTimer=null,pendingTape=[];
  const formatQty=value=>number(value,3);
  function imported(tf) {
    try { const bars=getImportedBars(tf);return Array.isArray(bars)?bars:[]; }
    catch (_) { return []; }
  }
  function setText(id,value) { const el=$(id);if(el)el.textContent=value; }
  function setStatus(state,message) {
    const label=state==='connected'?'LIVE':state==='syncing'?'SYNCING':state==='reconnecting'?'RECONNECTING':state==='warning'?'WARNING':state==='error'?'ERROR':'DISCONNECTED';
    $('mdState').textContent=label;$('mdState').className='md-state md-'+state;
    setText('mdDetail',message||'');
    connected=['connecting','connected','syncing','reconnecting','warning'].includes(state);
    $('mdConnect').textContent=connected?'Disconnect':'Connect live';
    $('mdConnect').classList.toggle('md-disconnect',connected);
  }
  function mergeCandles(a,b) {
    const map=new Map();
    for(const c of a||[])map.set(Number(c.t),c);
    for(const c of b||[])map.set(Number(c.t),c);
    return Array.from(map.values()).sort((x,y)=>x.t-y.t).slice(-5000);
  }
  function scheduleDraw() {
    pendingDraw=true;
    if(renderTimer!==null)return;
    renderTimer=setTimeout(()=>{
      renderTimer=null;if(!pendingDraw)return;pendingDraw=false;drawCharts();
    },180);
  }
  function drawCharts() {
    const candleEl=$('mdCandles'),flowEl=$('mdFlow');
    if(!candleEl||candleEl.getBoundingClientRect().width<80)return;
    const visible=candles.slice(-3000);
    if(!visible.length) {
      $('mdCandleEmpty').hidden=false;setText('mdCandleMeta','No candles for this interval yet');
      if(Plotly&&Plotly.purge){try{Plotly.purge(candleEl);Plotly.purge(flowEl);}catch(_){}}
      return;
    }
    $('mdCandleEmpty').hidden=true;
    const x=visible.map(c=>Number(c.t));
    setText('mdCandleMeta',number(visible.length)+' candles shown'+(candles.length>visible.length?' · latest '+number(visible.length)+' of '+number(candles.length):''));
    if(!Plotly||typeof Plotly.react!=='function'){setText('mdCandleMeta','Plotly unavailable; data stream remains active.');return;}
    const candleTrace={type:'candlestick',name:'BTCUSD perpetual',x,open:visible.map(c=>c.o),high:visible.map(c=>c.h),low:visible.map(c=>c.l),close:visible.map(c=>c.c),
      customdata:visible.map(c=>[c.v,c.buyTaker,c.sellTaker,c.trades]),
      increasing:{line:{color:'#48d6ad',width:1},fillcolor:'#48d6ad'},decreasing:{line:{color:'#ff7e87',width:1},fillcolor:'#ff7e87'},
      whiskerwidth:.35,hovertemplate:'%{x|%Y-%m-%d %H:%M:%S UTC}<br>O %{open:,.1f} · H %{high:,.1f}<br>L %{low:,.1f} · C %{close:,.1f}<br>Total qty %{customdata[0]:,.3f}<br>BUY TAKER / SELL MAKER %{customdata[1]:,.3f}<br>SELL TAKER / BUY MAKER %{customdata[2]:,.3f}<br>Trades %{customdata[3]:,.0f}<extra></extra>'};
    const baseLayout={paper_bgcolor:'#0c1422',plot_bgcolor:'#0c1422',font:{color:'#dce7f5',size:10,family:'Inter,system-ui,sans-serif'},
      margin:{l:12,r:58,t:8,b:34},showlegend:false,hovermode:'x',uirevision:'coinm-'+interval,
      xaxis:{type:'date',gridcolor:'#203047',linecolor:'#203047',tickfont:{color:'#91a3bb'},rangeslider:{visible:true,thickness:.07,bgcolor:'#091220',bordercolor:'#203047'}},
      yaxis:{side:'right',gridcolor:'#203047',linecolor:'#203047',tickfont:{color:'#91a3bb'},fixedrange:false}};
    const config={responsive:true,displaylogo:false,scrollZoom:true,modeBarButtonsToRemove:['lasso2d','select2d']};
    try {
      const p=Plotly.react(candleEl,[candleTrace],baseLayout,config);
      if(p&&typeof p.catch==='function')p.catch(error=>setText('mdCandleMeta','Candlestick render failed: '+String(error)));
      if(flowEl.getBoundingClientRect().width>=80) {
        const buy=visible.map(c=>Number(c.buyTaker||0)),sell=visible.map(c=>-Number(c.sellTaker||0));
        const layout={paper_bgcolor:'#0c1422',plot_bgcolor:'#0c1422',font:{color:'#dce7f5',size:9},margin:{l:12,r:58,t:4,b:30},
          barmode:'relative',showlegend:true,legend:{orientation:'h',x:0,y:1.2,font:{size:9,color:'#91a3bb'}},
          xaxis:{type:'date',gridcolor:'#203047',linecolor:'#203047',tickfont:{color:'#91a3bb'}},
          yaxis:{title:'Executed qty',side:'right',gridcolor:'#203047',tickfont:{color:'#91a3bb'}},uirevision:'coinm-flow-'+interval};
        const traces=[
          {type:'bar',name:'BUY TAKER / SELL MAKER',x,y:buy,marker:{color:'#48d6ad',opacity:.85},hovertemplate:'%{x|%Y-%m-%d %H:%M:%S UTC}<br>BUY TAKER · SELL MAKER %{y:,.3f}<extra></extra>'},
          {type:'bar',name:'SELL TAKER / BUY MAKER',x,y:sell,customdata:sell.map(v=>-v),marker:{color:'#ff7e87',opacity:.85},hovertemplate:'%{x|%Y-%m-%d %H:%M:%S UTC}<br>SELL TAKER · BUY MAKER %{customdata:,.3f}<extra></extra>'}
        ];
        const pv=Plotly.react(flowEl,traces,layout,config);if(pv&&typeof pv.catch==='function')pv.catch(()=>{});
      }
    } catch(error) { setText('mdCandleMeta','Chart render failed: '+String(error)); }
  }
  function setCandleData(next,nextSource) {
    candles=Array.isArray(next)?next.slice():[];source=nextSource||'';
    setText('mdSource',source);scheduleDraw();
  }
  function updateStats(stats) {
    if(!stats)return;
    setText('mdPrice',stats.lastPrice===null?'—':number(stats.lastPrice,1));
    setText('mdBuyTaker',formatQty(stats.buyTaker)+' qty');
    setText('mdSellTaker',formatQty(stats.sellTaker)+' qty');
    const delta=Number(stats.delta||0);setText('mdDelta',(delta>0?'+':'')+formatQty(delta)+' qty');
    $('mdDelta').className=delta>0?'md-positive':delta<0?'md-negative':'';
  }
  function cell(text,className) { const td=document.createElement('td');td.textContent=text;if(className)td.className=className;return td; }
  function renderBook(view) {
    if(!view||!view.ready) {
      setText('mdBookState','Waiting for sequence sync');
      $('mdBookRows').innerHTML='<tr><td colspan="4" class="md-muted">Waiting for a synchronized depth snapshot…</td></tr>';
      setText('mdSpread','—');return;
    }
    const bids=view.bids||[],asks=view.asks||[],bestBid=bids[0],bestAsk=asks[0];
    setText('mdBookState','SYNCED · update '+number(view.lastUpdateId,0));
    setText('mdBestBid',bestBid?number(bestBid.price,1):'—');setText('mdBestAsk',bestAsk?number(bestAsk.price,1):'—');
    const spread=bestBid&&bestAsk?bestAsk.price-bestBid.price:null;
    const spreadText=spread===null?'—':number(spread,2)+' · '+number(spread/((bestAsk.price+bestBid.price)/2)*10000,2)+' bps';
    setText('mdBookSpread',spreadText);setText('mdSpread',spread===null?'—':number(spread,2));
    const askRows=asks.slice(0,14),bidRows=bids.slice(0,14);
    const maxQty=Math.max(1,...askRows.map(x=>x.qty),...bidRows.map(x=>x.qty));
    const tbody=$('mdBookRows');tbody.innerHTML='';
    for(let i=0;i<14;i++) {
      const bid=bidRows[i],ask=askRows[i],tr=document.createElement('tr');
      const bidQty=cell('','md-bid-qty'),bidPrice=cell(bid?number(bid.price,1):'','md-bid-price');
      const askPrice=cell(ask?number(ask.price,1):'','md-ask-price'),askQty=cell('','md-ask-qty');
      if(bid){const bar=document.createElement('span');bar.className='md-depth-bar md-bid-depth';bar.style.width=(bid.qty/maxQty*100).toFixed(1)+'%';const val=document.createElement('span');val.textContent=formatQty(bid.qty);bidQty.append(bar,val);}
      if(ask){const bar=document.createElement('span');bar.className='md-depth-bar md-ask-depth';bar.style.width=(ask.qty/maxQty*100).toFixed(1)+'%';const val=document.createElement('span');val.textContent=formatQty(ask.qty);askQty.append(bar,val);}
      tr.append(bidQty,bidPrice,askPrice,askQty);tbody.appendChild(tr);
    }
    const c=view.changes||{};
    setText('mdBookFoot','Last update '+number(view.lastUpdateId,0)+' · level qty added/reduced since latest diff: bids +'+formatQty(c.bidAdded||0)+' / −'+formatQty(c.bidReduced||0)+' · asks +'+formatQty(c.askAdded||0)+' / −'+formatQty(c.askReduced||0)+'. Reductions may be executions or cancellations; the feed does not distinguish them.');
  }
  function queueTape(items) {
    pendingTape=items||[];
    if(tapeTimer!==null)return;
    tapeTimer=setTimeout(()=>{tapeTimer=null;renderTape(pendingTape);},100);
  }
  function renderTape(items) {
    recentTrades=items||[];const host=$('mdTape');host.innerHTML='';
    if(!recentTrades.length){host.innerHTML='<div class="md-empty">Waiting for aggregate trades…</div>';return;}
    for(const trade of recentTrades.slice(0,30)) {
      const row=document.createElement('div');row.className='md-tape-row';
      const time=cell(utcTime(trade.time),'md-tape-time'),price=cell(number(trade.price,1),trade.takerSide==='BUY'?'md-positive':'md-negative'),qty=cell(formatQty(trade.qty),'md-tape-qty');
      const sides=document.createElement('span');sides.className='md-tape-sides';
      const taker=document.createElement('b');taker.className='md-side-tag '+(trade.takerSide==='BUY'?'md-tag-buy':'md-tag-sell');taker.textContent=trade.takerSide+' TAKER';
      const maker=document.createElement('b');maker.className='md-side-tag '+(trade.makerSide==='BUY'?'md-tag-maker-buy':'md-tag-maker-sell');maker.textContent=trade.makerSide+' MAKER';
      sides.append(taker,maker);row.append(time,price,qty,sides);host.appendChild(row);
    }
  }
  const feed=createCoinMMarketFeed({
    symbol:'BTCUSD_PERP',
    onStatus:event=>setStatus(event.state,event.message),
    onCandles:event=>{
      if(event.interval!==interval)return;
      const local=interval==='10s'?imported('10s'):[];
      setCandleData(mergeCandles(local,event.candles||[]),event.source+(local.length?' + imported historical 10-second trades':''));
    },
    onKline:(candle,tf)=>{
      if(tf!==interval)return;
      candles=mergeCandles(candles,[candle]);source='Binance COIN-M REST + live kline stream';
      setText('mdSource',source);scheduleDraw();
    },
    onTrade:(trade,state)=>{
      updateStats(state.stats);queueTape(state.recentTrades);
      if(SECOND_INTERVALS.includes(interval)&&state.candle) {
        candles=mergeCandles(candles,[state.candle]);
        source='Live aggregate trades since connection'+(interval==='10s'&&imported('10s').length?' + imported historical trades':'');
        setText('mdSource',source);scheduleDraw();
      }
    },
    onBook:renderBook
  });
  function showImportedInterval(tf) {
    const local=tf==='10s'?imported('10s'):[];
    if(tf==='10s'&&local.length)setCandleData(local,'Imported historical archive · 10-second candles');
    else if(SECOND_INTERVALS.includes(tf))setCandleData([],'Live session only · no exchange historical '+tf+' kline endpoint');
  }
  async function chooseInterval(tf) {
    interval=tf;setText('mdCandleMeta','Loading '+intervalLabel(tf)+' candles…');showImportedInterval(tf);
    if(connected){try{await feed.setInterval(tf);}catch(error){setText('mdCandleMeta','Interval change failed: '+String(error));}}
    else if(!SECOND_INTERVALS.includes(tf))setCandleData([],'Connect live to load Binance COIN-M '+tf+' candles');
  }
  $('mdConnect').addEventListener('click',async()=>{
    if(connected){feed.disconnect();return;}
    $('mdConnect').disabled=true;
    try{await feed.connect(interval);}
    catch(error){setStatus('error','Could not connect to Binance COIN-M market data: '+String(error&&error.message||error));}
    finally{$('mdConnect').disabled=false;}
  });
  intervalSelect.addEventListener('change',()=>chooseInterval(intervalSelect.value));
  const resize=()=>{
    if(!root.getBoundingClientRect().width)return;
    if(Plotly&&Plotly.Plots&&Plotly.Plots.resize)for(const id of ['mdCandles','mdFlow']){const el=$(id);if(el&&el.data)try{Plotly.Plots.resize(el);}catch(_){}}
    if(pendingDraw)scheduleDraw();
  };
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(resize).observe(root);
  if(typeof window!=='undefined')window.addEventListener('resize',resize,{passive:true});
  return {
    activate(){resize();if(pendingDraw||candles.length)scheduleDraw();},
    getInterval(){return interval;},
    syncImportedBars(){if(interval==='10s'&&!connected)showImportedInterval('10s');},
    setInterval:chooseInterval
  };
}
