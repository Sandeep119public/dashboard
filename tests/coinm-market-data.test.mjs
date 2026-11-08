import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAggTrade,parseCoinMKline,normalizeKlineEvent,aggregateTradesToCandles,
  isDepthSnapshotBridge,isDepthUpdateContinuous,applyDepthEvent,createMinuteFootprintState,updateMinuteFootprint,
  mergeCandleSeries, COINM_CONTRACT_USD, MARKET_INTERVALS, createCoinMMarketFeed, createMinuteFootprintState, updateMinuteFootprint
} from '../src/market/coinm-market-data.js';

test('buyer maker flag maps aggressor and passive sides to mirrored quantities',()=>{
  const buy=normalizeAggTrade({e:'aggTrade',a:1,p:'67000',q:'2.5',T:1000,m:false});
  assert.equal(buy.takerSide,'BUY');assert.equal(buy.makerSide,'SELL');
  assert.equal(buy.buyTakerQty,2.5);assert.equal(buy.makerSellQty,2.5);assert.equal(buy.sellTakerQty,0);
  const sell=normalizeAggTrade({e:'aggTrade',a:2,p:'66999',q:'3',T:2000,m:true});
  assert.equal(sell.takerSide,'SELL');assert.equal(sell.makerSide,'BUY');
  assert.equal(sell.sellTakerQty,3);assert.equal(sell.makerBuyQty,3);assert.equal(sell.buyTakerQty,0);
});

test('COIN-M klines derive taker sell and passive maker counterpart quantities',()=>{
  const c=parseCoinMKline([60000,'100','110','90','105','12',119999,'0.12',7,'8','0.08','0']);
  assert.deepEqual([c.t,c.o,c.h,c.l,c.c,c.v,c.trades,c.buyTaker,c.sellTaker,c.makerSell,c.makerBuy,c.delta],[60000,100,110,90,105,12,7,8,4,8,4,4]);
  const live=normalizeKlineEvent({t:60000,o:'100',h:'110',l:'90',c:'105',v:'12',T:119999,n:7,V:'8',Q:'0.08'});
  assert.equal(live.buyTaker,8);assert.equal(live.sellTaker,4);
});

test('trade-built candles are ordered and preserve OHLC and maker/taker quantities',()=>{
  const trades=[
    normalizeAggTrade({a:3,p:'102',q:'2',T:12000,m:true}),
    normalizeAggTrade({a:1,p:'100',q:'1',T:1000,m:false}),
    normalizeAggTrade({a:2,p:'101',q:'3',T:5000,m:false}),
    normalizeAggTrade({a:4,p:'99',q:'4',T:21000,m:false})
  ];
  const bars=aggregateTradesToCandles(trades,10000);
  assert.equal(bars.length,3);
  assert.deepEqual([bars[0].t,bars[0].o,bars[0].h,bars[0].l,bars[0].c,bars[0].v,bars[0].buyTaker,bars[0].sellTaker,bars[0].makerSell,bars[0].makerBuy,bars[0].delta],[0,100,101,100,101,4,4,0,4,0,4]);
  assert.deepEqual([bars[1].t,bars[1].o,bars[1].h,bars[1].l,bars[1].c,bars[1].v,bars[1].buyTaker,bars[1].sellTaker,bars[1].makerSell,bars[1].makerBuy,bars[1].delta],[10000,102,102,102,102,2,0,2,0,2,-2]);
  assert.deepEqual([bars[2].t,bars[2].o,bars[2].h,bars[2].l,bars[2].c,bars[2].v,bars[2].buyTaker,bars[2].sellTaker],[20000,99,99,99,99,4,4,0]);
});

test('live minute footprint aggregates executed quantity by price and resets on minute boundary',()=>{
  const state=createMinuteFootprintState();
  const buy=normalizeAggTrade({a:1,p:'67000',q:'2',T:1000,m:false});
  const sell=normalizeAggTrade({a:2,p:'67000',q:'3',T:2000,m:true});
  const nextPrice=normalizeAggTrade({a:3,p:'66999',q:'4',T:3000,m:true});
  let result=updateMinuteFootprint(state,buy);
  result=updateMinuteFootprint(state,sell);
  result=updateMinuteFootprint(state,nextPrice);
  assert.equal(result.levelsTotal,2);
  const level=result.levels.find(x=>x.price===67000);
  assert.deepEqual([level.buyTaker,level.sellTaker,level.makerSell,level.makerBuy,level.trades,level.delta],[2,3,2,3,2,-1]);
  result=updateMinuteFootprint(state,normalizeAggTrade({a:4,p:'67001',q:'5',T:60000,m:false}));
  assert.equal(result.minute,60000);
  assert.equal(result.levelsTotal,1);
  assert.equal(result.levels[0].price,67001);
  assert.equal(result.levels[0].buyTaker,5);
});

test('depth synchronization requires a snapshot-bridging event and continuous pu sequence',()=>{
  assert.equal(isDepthSnapshotBridge(100,{U:95,u:100}),true);
  assert.equal(isDepthSnapshotBridge(100,{U:90,u:99}),false);
  assert.equal(isDepthSnapshotBridge(100,{U:101,u:105}),false);
  assert.equal(isDepthSnapshotBridge(100,{U:102,u:105}),false);
  assert.equal(isDepthUpdateContinuous(105,{U:106,u:108,pu:105}),true);
  assert.equal(isDepthUpdateContinuous(105,{U:106,u:108,pu:104}),false);
  assert.equal(isDepthUpdateContinuous(105,{U:106,u:108}),true);
});

test('depth updates replace quantities and remove zero-quantity levels',()=>{
  const book={bids:new Map([['67000',5],['66999',4]]),asks:new Map([['67001',6]]),lastUpdateId:10};
  const changes=applyDepthEvent(book,{U:11,u:12,pu:10,b:[['67000','7'],['66999','0']],a:[['67001','2'],['67002','3']]});
  assert.equal(book.lastUpdateId,12);assert.equal(book.bids.get('67000'),7);assert.equal(book.bids.has('66999'),false);
  assert.equal(book.asks.get('67001'),2);assert.equal(book.asks.get('67002'),3);
  assert.deepEqual(changes,{
    bidAdded:2,bidReduced:4,askAdded:3,askReduced:4,
    bidChanges:{67000:2,66999:-4},askChanges:{67001:-4,67002:3}
  });
});

test('depth replay imports validate, deduplicate and sort captured snapshots',()=>{
  const feed=createCoinMMarketFeed({fetchImpl:async()=>({ok:true,json:async()=>[]}),WebSocketImpl:null});
  const sample=(time,id)=>({time,updatedAt:time,lastUpdateId:id,segment:1,bids:[{price:100,qty:2}],asks:[{price:101,qty:3}]});
  const info=feed.restoreDepthHistory([sample(2000,2),sample(1000,1),sample(2000,2)]);
  assert.equal(info.count,2);
  assert.equal(feed.getDepthSnapshot(0).time,1000);
  assert.equal(feed.getDepthSnapshot(1).lastUpdateId,2);
  assert.throws(()=>feed.restoreDepthHistory([sample(3000,3).bids]),/timestamp, sequence ID or book side/i);
  assert.throws(()=>feed.restoreDepthHistory([{...sample(3000,3),bids:[{price:100,qty:0}]}]),/invalid price level/i);
});

test('footprint windows aggregate executed price levels across 1m, 5m and 15m', async()=>{
  const feed=createCoinMMarketFeed({fetchImpl:async()=>({ok:true,json:async()=>[]}),WebSocketImpl:null,now:()=>900000});
  const add=(time,price,qty,buyerIsMaker)=>feed.addTrade({a:time,p:String(price),q:String(qty),T:time,m:buyerIsMaker});
  add(60000,100,2,false);
  add(120000,100,3,true);
  add(360000,101,4,false);
  const five=feed.getFootprintWindow(360000,5);
  assert.equal(five.timeframeMinutes,5);
  assert.equal(five.totalQty,7);
  assert.equal(five.levels.find(level=>level.price===100).buyTaker,2);
  assert.equal(five.levels.find(level=>level.price===100).sellTaker,3);
  assert.equal(feed.getFootprintWindow(360000,15).totalQty,9);
  assert.equal(feed.getFootprintWindow(360000,1).totalQty,4);
});

test('invalid trade and malformed kline records are rejected',()=>{
  assert.throws(()=>normalizeAggTrade({a:1,p:'0',q:'1',T:1,m:false}),/invalid timestamp, price or quantity/i);
  assert.throws(()=>parseCoinMKline([1,2,3]),/12-field/i);
  assert.throws(()=>normalizeAggTrade({a:1,p:'100',q:'1',T:1}),/buyer was maker/i);
  assert.throws(()=>normalizeAggTrade({a:1,p:'100',q:'1',T:1,m:'false'}),/buyer was maker/i);
  assert.throws(()=>parseCoinMKline([60000,'100','110','90','105','12',119999,'0.12',7,'13','0.08','0']),/taker-buy volume exceeds/i);
  assert.throws(()=>parseCoinMKline([60000,'100','110','120','105','12',119999,'0.12',7,'8','0.08','0']),/OHLC values are inconsistent/i);
  assert.throws(()=>parseCoinMKline([60000,'0','110','90','105','12',119999,'0.12',7,'8','0.08','0']),/invalid price/i);
});

test('market intervals keep exchange klines distinct from trade-built seconds',()=>{
  const kline=MARKET_INTERVALS.filter(x=>x.source==='Binance COIN-M candles').map(x=>x.value);
  const seconds=MARKET_INTERVALS.filter(x=>x.source==='Live trade-built').map(x=>x.value);
  assert.deepEqual(seconds,['1s','5s','10s','15s','30s']);
  assert.ok(kline.includes('1m')&&kline.includes('1M'));
  assert.ok(!kline.some(value=>value.endsWith('s')));
  assert.equal(COINM_CONTRACT_USD,100);
});

test('candle merges deduplicate timestamps, let live bars win and never fill gaps',()=>{
  const rest=[{t:1000,c:10},{t:2000,c:20},{t:4000,c:40}];
  const live=[{t:2000,c:25},{t:3000,c:30}];
  const merged=mergeCandleSeries(rest,live);
  assert.deepEqual(merged.map(c=>c.t),[1000,2000,3000,4000]);
  assert.equal(merged[1].c,25);
  assert.deepEqual(mergeCandleSeries(rest,live,2).map(c=>c.t),[3000,4000]);
  assert.deepEqual(mergeCandleSeries([{t:'bad',c:1},{t:1000,c:2}],[],10).map(c=>c.t),[1000]);
});

test('footprint reports imbalance and truncates to the levels nearest the latest trade',()=>{
  const state=createMinuteFootprintState();
  let result;
  for(let i=0;i<6;i++){
    const price=67000+i;
    result=updateMinuteFootprint(state,normalizeAggTrade({a:i+1,p:String(price),q:i<3?'2':'3',T:1000+i,m:i%2===1}),100,2);
  }
  assert.equal(result.levelsTotal,6);
  assert.equal(result.levels.length,2);
  assert.equal(result.truncated,true);
  assert.deepEqual(result.levels.map(x=>x.price).sort((a,b)=>a-b),[67004,67005]);
  assert.ok(result.imbalance<0&&result.imbalance>-1);
  assert.equal(result.totalQty,15);
  assert.deepEqual([result.totalBuy,result.totalSell],[7,8]);
});

test('depth snapshot bridge accepts the event that spans the snapshot id',()=>{
  assert.equal(isDepthSnapshotBridge(100,{U:100,u:101}),true);
  assert.equal(isDepthSnapshotBridge(100,{U:99,u:100}),true);
  assert.equal(isDepthSnapshotBridge(100,{U:101,u:103}),false);
  assert.equal(isDepthUpdateContinuous(10,{U:12,u:14,pu:9}),false);
  assert.equal(isDepthUpdateContinuous(10,{U:11,u:14}),true);
});
