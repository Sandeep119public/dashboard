const COINM_REST = 'https://dapi.binance.com';
const COINM_WS = 'wss://dstream.binance.com/stream';
const KLINE_INTERVALS = Object.freeze(['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M']);
const SECOND_INTERVALS = Object.freeze(['1s','5s','10s','15s','30s']);
const INTERVAL_MS = Object.freeze({'1s':1000,'5s':5000,'10s':10000,'15s':15000,'30s':30000});
export const MARKET_INTERVALS = Object.freeze([
  ...SECOND_INTERVALS.map(value=>({value,label:value==='1s'?'1 second':value==='5s'?'5 seconds':value==='10s'?'10 seconds':value==='15s'?'15 seconds':'30 seconds',source:'Live trade-built'})),
  ...KLINE_INTERVALS.map(value=>({value,label:value==='1M'?'1 month':value,source:'Binance COIN-M candles'}))
]);
const KLINE_SET = new Set(KLINE_INTERVALS);
const SECOND_SET = new Set(SECOND_INTERVALS);

export function normalizeAggTrade(raw) {
  if (!raw || raw.e !== 'aggTrade' && raw.a === undefined) throw new TypeError('Expected a Binance aggregate-trade event.');
  const time=Number(raw.T ?? raw.time),price=Number(raw.p ?? raw.price),qty=Number(raw.q ?? raw.qty);
  if(!Number.isFinite(time)||!Number.isFinite(price)||price<=0||!Number.isFinite(qty)||qty<=0)throw new TypeError('Aggregate trade contains an invalid timestamp, price or quantity.');
  const buyerIsMaker=Boolean(raw.m ?? raw.buyerIsMaker);
  const takerSide=buyerIsMaker?'SELL':'BUY',makerSide=buyerIsMaker?'BUY':'SELL';
  return {id:Number(raw.a ?? raw.id ?? 0),time,price,qty,buyerIsMaker,takerSide,makerSide,
    buyTakerQty:buyerIsMaker?0:qty,sellTakerQty:buyerIsMaker?qty:0,
    makerBuyQty:buyerIsMaker?qty:0,makerSellQty:buyerIsMaker?0:qty};
}

export function parseCoinMKline(row) {
  if(!Array.isArray(row)||row.length<12)throw new TypeError('Expected a 12-field Binance COIN-M kline row.');
  const c={t:Number(row[0]),o:Number(row[1]),h:Number(row[2]),l:Number(row[3]),c:Number(row[4]),v:Number(row[5]),
    closeTime:Number(row[6]),trades:Number(row[8]),buyTaker:Number(row[9]),buyTakerBase:Number(row[10])};
  if(!Number.isFinite(c.t)||![c.o,c.h,c.l,c.c,c.v,c.buyTaker].every(Number.isFinite))throw new TypeError('Kline contains invalid numeric fields.');
  c.sellTaker=Math.max(0,c.v-c.buyTaker);c.makerSell=c.buyTaker;c.makerBuy=c.sellTaker;c.delta=c.buyTaker-c.sellTaker;
  return c;
}
export function normalizeKlineEvent(k) {
  if(!k||typeof k!=='object')throw new TypeError('Expected a Binance kline stream payload.');
  return parseCoinMKline([k.t,k.o,k.h,k.l,k.c,k.v,k.T,0,k.n,k.V,k.Q,0]);
}
export function aggregateTradesToCandles(trades,intervalMs) {
  if(!Number.isFinite(intervalMs)||intervalMs<=0)throw new RangeError('intervalMs must be positive.');
  const sorted=Array.from(trades||[]).slice().sort((a,b)=>Number(a.time)-Number(b.time)),map=new Map();
  for(const t of sorted){
    const time=Number(t.time),price=Number(t.price),qty=Number(t.qty);
    if(!Number.isFinite(time)||!Number.isFinite(price)||price<=0||!Number.isFinite(qty)||qty<=0)continue;
    const key=Math.floor(time/intervalMs)*intervalMs;
    let c=map.get(key);if(!c){c={t:key,o:price,h:price,l:price,c:price,v:0,trades:0,buyTaker:0,sellTaker:0,makerBuy:0,makerSell:0};map.set(key,c);}
    c.h=Math.max(c.h,price);c.l=Math.min(c.l,price);c.c=price;c.v+=qty;c.trades++;
    const buy=t.buyTakerQty!==undefined?Number(t.buyTakerQty):(t.buyerIsMaker?0:qty);
    const sell=t.sellTakerQty!==undefined?Number(t.sellTakerQty):(t.buyerIsMaker?qty:0);
    c.buyTaker+=buy;c.sellTaker+=sell;c.makerBuy+=sell;c.makerSell+=buy;
  }
  return Array.from(map.values()).sort((a,b)=>a.t-b.t).map(c=>({...c,delta:c.buyTaker-c.sellTaker}));
}
export function isDepthSnapshotBridge(lastId,event){const snapshotId=Number(lastId);return Number(event?.U)<=snapshotId&&Number(event?.u)>=snapshotId;}
export function isDepthUpdateContinuous(lastId,event){
  if(event?.pu!==undefined&&event?.pu!==null)return Number(event.pu)===Number(lastId);
  const next=Number(lastId)+1;return Number(event?.U)<=next&&Number(event?.u)>=next;
}
export function applyDepthEvent(book,event){
  if(!book||!(book.bids instanceof Map)||!(book.asks instanceof Map))throw new TypeError('Book must contain bid and ask Maps.');
  const changes={bidAdded:0,bidReduced:0,askAdded:0,askReduced:0};
  const apply=(map,levels,added,reduced)=>{for(const level of levels||[]){
    const price=String(level[0]),qty=Number(level[1]),prior=Number(map.get(price)||0);
    if(!Number.isFinite(Number(price))||!Number.isFinite(qty)||qty<0)continue;
    if(qty===0)map.delete(price);else map.set(price,qty);
    if(qty>prior)changes[added]+=qty-prior;else changes[reduced]+=prior-qty;
  }};
  apply(book.bids,event.b,'bidAdded','bidReduced');apply(book.asks,event.a,'askAdded','askReduced');
  book.lastUpdateId=Number(event.u);return changes;
}
function bookView(book,ready,changes={bidAdded:0,bidReduced:0,askAdded:0,askReduced:0}){
  const bids=Array.from(book.bids,([price,qty])=>({price:Number(price),qty})).sort((a,b)=>b.price-a.price).slice(0,25);
  const asks=Array.from(book.asks,([price,qty])=>({price:Number(price),qty})).sort((a,b)=>a.price-b.price).slice(0,25);
  return {ready,lastUpdateId:book.lastUpdateId,bids,asks,changes};
}

export function createCoinMMarketFeed(options={}) {
  const symbol=String(options.symbol||'BTCUSD_PERP').trim().toUpperCase();
  const fetchImpl=options.fetchImpl||((...args)=>fetch(...args));
  const WebSocketImpl=options.WebSocketImpl||(typeof WebSocket!=='undefined'?WebSocket:null);
  const onStatus=options.onStatus||(()=>{}),onCandles=options.onCandles||(()=>{}),onKline=options.onKline||(()=>{}),onTrade=options.onTrade||(()=>{}),onBook=options.onBook||(()=>{});
  let socket=null,retryTimer=null,stopped=true,retryCount=0,generation=0,activeInterval='1m';
  let snapshotInFlight=false,snapshotReady=false,bookReady=false,lastUpdateId=null,depthBuffer=[];
  let book={bids:new Map(),asks:new Map(),lastUpdateId:null};
  let recentTrades=[],stats={trades:0,buyTaker:0,sellTaker:0,delta:0,lastPrice:null},statsSince=null;
  const secondBars=new Map(SECOND_INTERVALS.map(tf=>[tf,new Map()]));
  const status=(state,message)=>onStatus({state,message});
  async function requestJson(url){
    const controller=typeof AbortController!=='undefined'?new AbortController():null;
    const timeout=controller?setTimeout(()=>controller.abort(),12000):null;
    try{const response=await fetchImpl(url,controller?{signal:controller.signal}:{});if(!response||!response.ok)throw new Error('Binance returned HTTP '+(response?response.status:'no response')+'.');return await response.json();}
    finally{if(timeout!==null)clearTimeout(timeout);}
  }
  async function loadKlines(interval,limit=1000){
    if(!KLINE_SET.has(interval))return [];
    const q=new URLSearchParams({symbol,interval,limit:String(Math.min(1000,Math.max(1,limit)))});
    const rows=await requestJson(COINM_REST+'/dapi/v1/klines?'+q.toString());
    if(!Array.isArray(rows))throw new Error('Unexpected Binance kline response.');
    return rows.map(parseCoinMKline);
  }
  function getSessionCandles(interval){
    const map=secondBars.get(interval);return map?Array.from(map.values()).map(c=>({...c})).sort((a,b)=>a.t-b.t):[];
  }
  function resetSession(){
    recentTrades=[];stats={trades:0,buyTaker:0,sellTaker:0,delta:0,lastPrice:null};statsSince=Date.now();
    for(const map of secondBars.values())map.clear();
  }
  function addTrade(raw){
    let trade;try{trade=normalizeAggTrade(raw);}catch(_){return;}
    recentTrades.unshift(trade);if(recentTrades.length>40)recentTrades.length=40;
    stats.trades++;stats.buyTaker+=trade.buyTakerQty;stats.sellTaker+=trade.sellTakerQty;
    stats.delta=stats.buyTaker-stats.sellTaker;stats.lastPrice=trade.price;
    for(const tf of SECOND_INTERVALS){
      const ms=INTERVAL_MS[tf],t=Math.floor(trade.time/ms)*ms,map=secondBars.get(tf);
      let c=map.get(t);if(!c){c={t,o:trade.price,h:trade.price,l:trade.price,c:trade.price,v:0,trades:0,buyTaker:0,sellTaker:0,makerBuy:0,makerSell:0};map.set(t,c);}
      c.h=Math.max(c.h,trade.price);c.l=Math.min(c.l,trade.price);c.c=trade.price;c.v+=trade.qty;c.trades++;
      c.buyTaker+=trade.buyTakerQty;c.sellTaker+=trade.sellTakerQty;c.makerBuy+=trade.makerBuyQty;c.makerSell+=trade.makerSellQty;c.delta=c.buyTaker-c.sellTaker;
      while(map.size>5000)map.delete(map.keys().next().value);
    }
    let candle=null;
    if(SECOND_SET.has(activeInterval)){
      const intervalMs=INTERVAL_MS[activeInterval],bucket=Math.floor(trade.time/intervalMs)*intervalMs;
      const current=secondBars.get(activeInterval).get(bucket);
      if(current)candle={...current};
    }
    onTrade(trade,{recentTrades:recentTrades.slice(),stats:{...stats,since:statsSince},candle});
  }
  function notifyBook(changes){onBook(bookView(book,bookReady,changes));}
  function applyAndNotify(event){
    const changes=applyDepthEvent(book,event);lastUpdateId=Number(event.u);book.lastUpdateId=lastUpdateId;bookReady=true;notifyBook(changes);
  }
  function beginBookSync(g,seed=[]){
    if(g!==generation)return;
    if(snapshotInFlight){if(seed.length)depthBuffer.push(...seed);return;}
    snapshotInFlight=true;snapshotReady=false;bookReady=false;depthBuffer=seed.slice();
    book={bids:new Map(),asks:new Map(),lastUpdateId:null};lastUpdateId=null;notifyBook();
    status('syncing','Synchronizing the order-book snapshot with sequenced depth updates…');
    (async()=>{
      try{
        const q=new URLSearchParams({symbol,limit:'1000'});
        const snap=await requestJson(COINM_REST+'/dapi/v1/depth?'+q.toString());
        if(g!==generation||stopped)return;
        book={bids:new Map((snap.bids||[]).map(x=>[String(x[0]),Number(x[1])])),asks:new Map((snap.asks||[]).map(x=>[String(x[0]),Number(x[1])])),lastUpdateId:Number(snap.lastUpdateId)};
        lastUpdateId=book.lastUpdateId;snapshotReady=true;snapshotInFlight=false;
        const queued=depthBuffer.splice(0);for(const event of queued)processDepth(event,g);
        if(!bookReady){notifyBook();status('syncing','Snapshot loaded. Waiting for the first update that bridges the snapshot sequence…');}
      }catch(error){
        snapshotInFlight=false;if(g!==generation||stopped)return;
        status('warning','Order-book snapshot failed: '+String(error&&error.message||error));
        retryTimer=setTimeout(()=>beginBookSync(g),2500);
      }
    })();
  }
  function processDepth(event,g){
    if(g!==generation||!event||event.u===undefined)return;
    if(!snapshotReady){
      depthBuffer.push(event);
      if(depthBuffer.length>2000){depthBuffer=depthBuffer.slice(-1000);if(!snapshotInFlight)beginBookSync(g,depthBuffer);}
      return;
    }
    if(!bookReady){
      if(Number(event.u)<Number(lastUpdateId))return;
      if(Number(event.U)>Number(lastUpdateId)){beginBookSync(g,[event]);return;}
      if(!isDepthSnapshotBridge(lastUpdateId,event))return;
      applyAndNotify(event);return;
    }
    if(!isDepthUpdateContinuous(lastUpdateId,event)){beginBookSync(g,[event]);return;}
    applyAndNotify(event);
  }
  function openSocket(){
    if(!WebSocketImpl){status('error','This browser does not support WebSocket market streams.');return;}
    if(socket){const old=socket;socket=null;try{old.close();}catch(_){}}
    const g=++generation;snapshotInFlight=false;snapshotReady=false;bookReady=false;depthBuffer=[];
    book={bids:new Map(),asks:new Map(),lastUpdateId:null};lastUpdateId=null;
    const streams=[symbol.toLowerCase()+'@aggTrade',symbol.toLowerCase()+'@depth@100ms'];
    if(KLINE_SET.has(activeInterval))streams.push(symbol.toLowerCase()+'@kline_'+activeInterval);
    const ws=new WebSocketImpl(COINM_WS+'?streams='+streams.join('/'));socket=ws;
    status('connecting','Opening Binance COIN-M public market streams…');
    ws.onopen=()=>{if(g!==generation||stopped)return;retryCount=0;status('connected','Live COIN-M trade and depth streams connected. Synchronizing the order book…');beginBookSync(g);};
    ws.onmessage=event=>{
      if(g!==generation||stopped)return;let payload;try{payload=JSON.parse(event.data);}catch(_){return;}
      const data=payload&&payload.data?payload.data:payload;if(!data)return;
      if(data.e==='aggTrade')addTrade(data);
      else if(data.e==='depthUpdate')processDepth(data,g);
      else if(data.e==='kline'&&data.k&&KLINE_SET.has(activeInterval)&&data.k.i===activeInterval){try{onKline(normalizeKlineEvent(data.k),activeInterval);}catch(_){}}
    };
    ws.onerror=()=>{if(g===generation&&!stopped)status('warning','WebSocket error. Waiting for the connection to recover…');};
    ws.onclose=()=>{
      if(g!==generation||stopped)return;socket=null;snapshotReady=false;bookReady=false;snapshotInFlight=false;
      notifyBook();
      status('reconnecting','Market stream disconnected. Reconnecting automatically…');
      const wait=Math.min(30000,1000*Math.pow(2,Math.min(5,retryCount++)));
      retryTimer=setTimeout(()=>{if(!stopped)openSocket();},wait);
    };
  }
  async function refreshInterval(){
    if(KLINE_SET.has(activeInterval)){
      try{const candles=await loadKlines(activeInterval,1000);onCandles({interval:activeInterval,candles,source:'Binance COIN-M REST klines'});return candles;}
      catch(error){status('warning','Live stream may connect, but historical candles could not be loaded: '+String(error&&error.message||error));return [];}
    }
    const candles=getSessionCandles(activeInterval);onCandles({interval:activeInterval,candles,source:'Live aggregate trades since connection'});return candles;
  }
  function connect(interval=activeInterval){
    if(!KLINE_SET.has(interval)&&!SECOND_SET.has(interval))throw new RangeError('Unsupported market interval: '+interval);
    if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}
    stopped=false;retryCount=0;activeInterval=interval;resetSession();openSocket();return refreshInterval();
  }
  async function setInterval(interval){
    if(!KLINE_SET.has(interval)&&!SECOND_SET.has(interval))throw new RangeError('Unsupported market interval: '+interval);
    activeInterval=interval;if(stopped)return [];
    const candles=await refreshInterval();if(!stopped)openSocket();return candles;
  }
  function disconnect(){
    stopped=true;if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}
    generation++;snapshotInFlight=false;snapshotReady=false;bookReady=false;depthBuffer=[];
    if(socket){const old=socket;socket=null;try{old.close();}catch(_){}}
    book={bids:new Map(),asks:new Map(),lastUpdateId:null};lastUpdateId=null;notifyBook();
    status('disconnected','Disconnected. Historical candles remain visible; live trades and depth are paused.');
  }
  return {connect,disconnect,setInterval,loadKlines,getSessionCandles,getStatus:()=>({connected:!stopped,interval:activeInterval,symbol})};
}
