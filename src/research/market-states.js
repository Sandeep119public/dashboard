/**
 * Descriptive, past-only hourly market-state labels.
 * Percentile baselines use only bars strictly before the bar being labelled.
 * These are research descriptors, not trading signals or causal explanations.
 */
export const MARKET_STATE_LABELS = Object.freeze(['Warm-up','Compression','Wide rotation','High-activity rotation','Directional travel','Volatility expansion','Mixed']);
const STATE = Object.freeze({ WARMUP:0, COMPRESSION:1, WIDE_ROTATION:2, HIGH_ACTIVITY_ROTATION:3, DIRECTIONAL_TRAVEL:4, VOLATILITY_EXPANSION:5, MIXED:6 });
function percentileAgainstPast(values,index,lookback,minimumSamples) {
  const current=values[index]; if(!Number.isFinite(current)) return null;
  const start=Math.max(0,index-lookback); let count=0,atOrBelow=0;
  for(let i=start;i<index;i++){const value=values[i];if(!Number.isFinite(value))continue;count++;if(value<=current)atOrBelow++;}
  return count>=minimumSamples?atOrBelow/count:null;
}
function validateBars(bars) {
  if(!bars||typeof bars!=='object')throw new TypeError('Market-state input must be a bar series.');
  const keys=['t','o','h','l','c','v'],length=Array.isArray(bars.t)?bars.t.length:-1;
  if(length<0||keys.some(key=>!Array.isArray(bars[key])||bars[key].length!==length))throw new TypeError('Market-state bars require equal-length t, o, h, l, c and v arrays.');
  let previous=-Infinity;
  for(let i=0;i<length;i++){
    const t=Number(bars.t[i]),o=Number(bars.o[i]),h=Number(bars.h[i]),l=Number(bars.l[i]),c=Number(bars.c[i]),v=Number(bars.v[i]);
    if(![t,o,h,l,c,v].every(Number.isFinite)||o<=0||l<=0||h<Math.max(o,l,c)||l>Math.min(o,h,c)||v<0||t<=previous)throw new RangeError('Market-state bars contain invalid or non-chronological OHLCV values at index '+i+'.');
    previous=t;
  }
  return length;
}
/** Classify bars from trailing volatility, candle range, activity and directional efficiency. */
export function classifyMarketStates(bars,options={}) {
  const length=validateBars(bars),lookback=Math.max(10,Math.floor(Number(options.lookback)||200));
  const volatilityWindow=Math.max(5,Math.floor(Number(options.volatilityWindow)||20));
  const efficiencyWindow=Math.max(3,Math.floor(Number(options.efficiencyWindow)||12));
  const minimumSamples=Math.max(5,Math.min(lookback,Math.floor(Number(options.minimumSamples)||30)));
  const intervalSeconds=options.intervalSeconds===undefined?3600:Number(options.intervalSeconds);
  if(!Number.isFinite(intervalSeconds)||intervalSeconds<=0)throw new RangeError('intervalSeconds must be positive.');
  const volatility=new Array(length).fill(null),rangePct=new Array(length).fill(null),activity=new Array(length).fill(null),efficiency=new Array(length).fill(null);
  let segment=0;
  for(let i=0;i<length;i++){
    if(i>0&&Number(bars.t[i])-Number(bars.t[i-1])!==intervalSeconds)segment=i;
    const open=Number(bars.o[i]),high=Number(bars.h[i]),low=Number(bars.l[i]),close=Number(bars.c[i]),volume=Number(bars.v[i]);
    rangePct[i]=(high-low)/open*100;activity[i]=Math.log1p(volume);
    if(i>segment){
      const first=Math.max(segment+1,i-volatilityWindow+1);let sum=0,sumSq=0,count=0;
      for(let j=first;j<=i;j++){const previous=Number(bars.c[j-1]),current=Number(bars.c[j]);if(previous<=0||current<=0)continue;const change=Math.log(current/previous);sum+=change;sumSq+=change*change;count++;}
      if(count>=Math.min(8,volatilityWindow)){const mean=sum/count;volatility[i]=Math.sqrt(Math.max(0,sumSq/count-mean*mean))*100;}
    }
    const efficiencyStart=Math.max(segment,i-efficiencyWindow);
    if(i-efficiencyStart>=2){let path=0;for(let j=efficiencyStart+1;j<=i;j++)path+=Math.abs(Number(bars.c[j])-Number(bars.c[j-1]));const net=Math.abs(close-Number(bars.c[efficiencyStart]));efficiency[i]=path>0?Math.min(1,net/path):0;}
  }
  const values=new Array(length);
  for(let i=0;i<length;i++){
    const volatilityPct=percentileAgainstPast(volatility,i,lookback,minimumSamples),rangePercentile=percentileAgainstPast(rangePct,i,lookback,minimumSamples),activityPercentile=percentileAgainstPast(activity,i,lookback,minimumSamples),directionalEfficiency=efficiency[i];
    let code=STATE.WARMUP;
    if(volatilityPct!==null&&rangePercentile!==null&&activityPercentile!==null&&directionalEfficiency!==null){
      if(volatilityPct>=0.9&&rangePercentile>=0.9)code=STATE.VOLATILITY_EXPANSION;
      else if(volatilityPct<=0.2&&rangePercentile<=0.2)code=STATE.COMPRESSION;
      else if(directionalEfficiency>=0.65&&volatilityPct>=0.5)code=STATE.DIRECTIONAL_TRAVEL;
      else if(activityPercentile>=0.8&&directionalEfficiency<=0.25)code=STATE.HIGH_ACTIVITY_ROTATION;
      else if(directionalEfficiency<=0.25&&rangePercentile>=0.5)code=STATE.WIDE_ROTATION;
      else code=STATE.MIXED;
    }
    values[i]={code,state:MARKET_STATE_LABELS[code],volatilityPct,rangePct:rangePercentile,activityPct:activityPercentile,efficiency:directionalEfficiency};
  }
  return {labels:MARKET_STATE_LABELS,values,settings:{lookback,volatilityWindow,efficiencyWindow,minimumSamples,intervalSeconds},methodology:'Past-only percentile ranks; no future bars are used.'};
}
