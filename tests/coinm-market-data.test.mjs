import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAggTrade,parseCoinMKline,normalizeKlineEvent,aggregateTradesToCandles,
  isDepthSnapshotBridge,isDepthUpdateContinuous,applyDepthEvent
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
  assert.equal(bars.length,2);
  assert.deepEqual([bars[0].t,bars[0].o,bars[0].h,bars[0].l,bars[0].c,bars[0].v,bars[0].buyTaker,bars[0].sellTaker,bars[0].makerSell,bars[0].makerBuy,bars[0].delta],[0,100,102,100,102,6,4,2,4,2,2]);
  assert.equal(bars[1].t,20000);assert.equal(bars[1].c,99);
});

test('depth synchronization requires a snapshot-bridging event and continuous pu sequence',()=>{
  assert.equal(isDepthSnapshotBridge(100,{U:101,u:105}),true);
  assert.equal(isDepthSnapshotBridge(100,{U:102,u:105}),false);
  assert.equal(isDepthSnapshotBridge(100,{U:95,u:100}),false);
  assert.equal(isDepthUpdateContinuous(105,{U:106,u:108,pu:105}),true);
  assert.equal(isDepthUpdateContinuous(105,{U:106,u:108,pu:104}),false);
  assert.equal(isDepthUpdateContinuous(105,{U:106,u:108}),true);
});

test('depth updates replace quantities and remove zero-quantity levels',()=>{
  const book={bids:new Map([['67000',5],['66999',4]]),asks:new Map([['67001',6]]),lastUpdateId:10};
  const changes=applyDepthEvent(book,{U:11,u:12,pu:10,b:[['67000','7'],['66999','0']],a:[['67001','2'],['67002','3']]});
  assert.equal(book.lastUpdateId,12);assert.equal(book.bids.get('67000'),7);assert.equal(book.bids.has('66999'),false);
  assert.equal(book.asks.get('67001'),2);assert.equal(book.asks.get('67002'),3);
  assert.deepEqual(changes,{bidAdded:2,bidReduced:4,askAdded:3,askReduced:4});
});

test('invalid trade and malformed kline records are rejected',()=>{
  assert.throws(()=>normalizeAggTrade({a:1,p:'0',q:'1',T:1,m:false}),/invalid timestamp, price or quantity/i);
  assert.throws(()=>parseCoinMKline([1,2,3]),/12-field/i);
});
