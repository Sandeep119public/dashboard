// Pure day-level trade aggregation. UI state and file parsing live elsewhere.
// Packed rows are read through their flat buffer to avoid a method call per field per bar.
const DEFAULT_BAR_STEPS = {'10s':10,'1m':60,'5m':300,'15m':900,'1h':3600};
const DEFAULT_HIST_LABELS = ['1–9','10–24','25–49','50–99','100–219','220–671','672–999','1k–1.9k','2k+'];
function histBucket(size){if(size<=9)return 0;if(size<=24)return 1;if(size<=49)return 2;if(size<=99)return 3;if(size<=219)return 4;if(size<=671)return 5;if(size<=999)return 6;if(size<=1999)return 7;return 8;}
function aggregateDay(date, rows, alreadyOrdered=false, barSteps=DEFAULT_BAR_STEPS, histLabels=DEFAULT_HIST_LABELS){
 if(!alreadyOrdered)rows.sortByTimestamp();
 const data=rows.data,count=rows.length,bars={};
 // One scan updates every requested timeframe instead of one full scan per timeframe.
 const timeframes=Object.keys(barSteps),steps=timeframes.map(tf=>barSteps[tf]),maps=timeframes.map(()=>new Map());
 for(let ri=0,o=0;ri<count;ri++,o+=4){
  const sec=data[o],price=data[o+1],size=data[o+2],role=data[o+3];
  for(let k=0;k<steps.length;k++){
   const step=steps[k],t=Math.floor(sec/step)*step,map=maps[k];
   let a=map.get(t);
   if(!a){a={t,o:price,h:price,l:price,c:price,v:0,n:0,b:0,s:0,d:0,pv:0};map.set(t,a);}
   if(price>a.h)a.h=price;if(price<a.l)a.l=price;a.c=price;a.v+=size;a.pv+=price*size;a.n++;
   if(role===1)a.b+=size;else a.s+=size;a.d=a.b-a.s;
  }
 }
 for(let k=0;k<timeframes.length;k++){
  const obj={t:[],o:[],h:[],l:[],c:[],v:[],n:[],b:[],s:[],d:[],pv:[]};
  for(const a of maps[k].values()){
   obj.t.push(a.t);obj.o.push(a.o);obj.h.push(a.h);obj.l.push(a.l);obj.c.push(a.c);
   obj.v.push(a.v);obj.n.push(a.n);obj.b.push(a.b);obj.s.push(a.s);obj.d.push(a.d);obj.pv.push(a.pv);
  }
  bars[timeframes[k]]=obj;
 }
 // Profile, metrics and large-trade follow-through share one scan over the packed rows.
 const prof=new Map(),hist=new Array(1440*9).fill(0),activeSeconds=new Uint8Array(86400),sizes=new Float64Array(count);
 const events={t:[],p:[],s:[],r:[],r1:[],r5:[],r15:[]},horizon=[60,300,900];
 let sizeIndex=0,total=0,buy=0,sell=0,high=-Infinity,low=Infinity,maxSize=0,activeCount=0;
 const lowerBound=(target,lo)=>{let hi=count;while(lo<hi){const mid=(lo+hi)>>1;if(data[mid*4]<target)lo=mid+1;else hi=mid;}return lo;};
 for(let ri=0,o=0;ri<count;ri++,o+=4){
  const sec=data[o],price=data[o+1],size=data[o+2],role=data[o+3];
  // Exact numeric key (minute < 1440, price bucket < 2^32) avoids a string per print.
  const minute=Math.floor(sec/60),bucket=Math.floor(price/5),key=minute*4294967296+bucket;
  let a=prof.get(key);if(!a){a={m:minute,p:bucket,v:0,d:0};prof.set(key,a);}
  const signed=role===1?size:-size;a.v+=size;a.d+=signed;
  hist[minute*9+histBucket(size)]++;
  const second=Math.floor(sec);if(!activeSeconds[second]){activeSeconds[second]=1;activeCount++;}
  sizes[sizeIndex++]=size;if(size>maxSize)maxSize=size;total+=size;if(price>high)high=price;if(price<low)low=price;
  if(role===1)buy+=size;else sell+=size;
  if(size>=220){
   events.t.push(sec);events.p.push(price);events.s.push(size);events.r.push(role);
   for(let j=0;j<horizon.length;j++){
    const target=sec+horizon[j],ix=lowerBound(target,ri+1),k=['r1','r5','r15'][j];
    events[k].push(ix<count&&data[ix*4]-target<=30?(data[ix*4+1]/price-1)*100:null);
   }
  }
 }
 // A native numeric sort is faster than four separate quickselect passes, and the
 // sorted order statistics are identical.
 sizes.sort();
 const quant=q=>sizes.length?sizes[Math.min(sizes.length-1,Math.floor((sizes.length-1)*q))]:0;
 const first=count?data[1]:0,last=count?data[(count-1)*4+1]:0;
 const profile={m:[],p:[],v:[],d:[]};for(const a of prof.values()){profile.m.push(a.m);profile.p.push(a.p);profile.v.push(a.v);profile.d.push(a.d);}
 const minuteBars=bars['1m'];let prev=null,prevTime=null,flow=[],rets=[];
 for(let i=0;i<minuteBars.t.length;i++){if(prev!==null&&prev!==0&&minuteBars.t[i]>prevTime&&minuteBars.t[i]-prevTime===60){flow.push(minuteBars.d[i]);rets.push((minuteBars.c[i]/prev-1)*100);}prev=minuteBars.c[i];prevTime=minuteBars.t[i];}
 const n=flow.length,mf=flow.reduce((a,v)=>a+v,0)/Math.max(1,n),mr=rets.reduce((a,v)=>a+v,0)/Math.max(1,n);let cv=0,vf=0,vr=0;
 for(let i=0;i<n;i++){const a=flow[i]-mf,b=rets[i]-mr;cv+=a*b;vf+=a*a;vr+=b*b;}
 const delta=buy-sell,metrics={date,row_count:count,start_price:first,end_price:last,return_pct:first?(last/first-1)*100:0,low:low===-Infinity?0:low,high:high===-Infinity?0:high,range_pct:low>0?(high/low-1)*100:0,total_size:total,buy_size:buy,sell_size:sell,delta,imbalance_pct:total?delta/total*100:0,median_size:quant(.5),p90:quant(.9),p95:quant(.95),p99:quant(.99),max_size:maxSize,active_seconds_pct:activeCount/86400*100,minute_flow_return_corr:n>=3&&vf&&vr?cv/Math.sqrt(vf*vr):null};
 return {metrics,bars,profile,hist,hist_labels:histLabels,events};
}

export { aggregateDay };
