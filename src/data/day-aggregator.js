// Pure day-level trade aggregation. UI state and file parsing live elsewhere.
const DEFAULT_BAR_STEPS = {'10s':10,'1m':60,'5m':300,'15m':900,'1h':3600};
const DEFAULT_HIST_LABELS = ['1–9','10–24','25–49','50–99','100–219','220–671','672–999','1k–1.9k','2k+'];
function histBucket(size){if(size<=9)return 0;if(size<=24)return 1;if(size<=49)return 2;if(size<=99)return 3;if(size<=219)return 4;if(size<=671)return 5;if(size<=999)return 6;if(size<=1999)return 7;return 8;}
function selectKthInPlace(a,k){
 let left=0,right=a.length-1;
 while(left<right){
  const mid=left+((right-left)>>1),x=a[left],y=a[mid],z=a[right];
  const pivot=x<y?(y<z?y:(x<z?z:x)):(x<z?x:(y<z?z:y));
  let lt=left,i=left,gt=right;
  while(i<=gt){
   if(a[i]<pivot){const t=a[lt];a[lt]=a[i];a[i]=t;lt++;i++;}
   else if(a[i]>pivot){const t=a[i];a[i]=a[gt];a[gt]=t;gt--;}
   else i++;
  }
  if(k<lt)right=lt-1;else if(k>gt)left=gt+1;else return a[k];
 }
 return a[left];
}
function aggregateDay(date, rows, alreadyOrdered=false, barSteps=DEFAULT_BAR_STEPS, histLabels=DEFAULT_HIST_LABELS){
  if(!alreadyOrdered)rows.sortByTimestamp();
  const bars={};
  for(const tf of Object.keys(barSteps)){
   const step=barSteps[tf],map=new Map();
   for(let ri=0;ri<rows.length;ri++){
    const sec=rows.get(ri,0),price=rows.get(ri,1),size=rows.get(ri,2),role=rows.get(ri,3),t=Math.floor(sec/step)*step;
    let a=map.get(t);if(!a){a={t,o:price,h:price,l:price,c:price,v:0,n:0,b:0,s:0,d:0,pv:0};map.set(t,a);}
    a.h=Math.max(a.h,price);a.l=Math.min(a.l,price);a.c=price;a.v+=size;a.pv+=price*size;a.n++;if(role===1)a.b+=size;else a.s+=size;a.d=a.b-a.s;
   }
   const vals=[...map.values()],obj={t:[],o:[],h:[],l:[],c:[],v:[],n:[],b:[],s:[],d:[],pv:[]};
   for(const a of vals)for(const k of Object.keys(obj))obj[k].push(a[k]);
   bars[tf]=obj;
  }
  const prof=new Map(),hist=new Array(1440*9).fill(0),active=new Set(),sizes=new Float64Array(rows.length);let sizeIndex=0,total=0,buy=0,sell=0,high=-Infinity,low=Infinity,maxSize=0;
  for(let ri=0;ri<rows.length;ri++){
   const sec=rows.get(ri,0),price=rows.get(ri,1),size=rows.get(ri,2),role=rows.get(ri,3),minute=Math.floor(sec/60),p=Math.floor(price/5),key=minute+'|'+p;
   let a=prof.get(key);if(!a){a={m:minute,p,v:0,d:0};prof.set(key,a);}a.v+=size;a.d+=role===1?size:-size;hist[minute*9+histBucket(size)]++;active.add(Math.floor(sec));sizes[sizeIndex++]=size;maxSize=Math.max(maxSize,size);total+=size;high=Math.max(high,price);low=Math.min(low,price);if(role===1)buy+=size;else sell+=size;
  }
  const quant=q=>sizes.length?selectKthInPlace(sizes,Math.min(sizes.length-1,Math.floor((sizes.length-1)*q))):0;
  const first=rows.length?rows.get(0,1):0,last=rows.length?rows.get(rows.length-1,1):0;
  const profile={m:[],p:[],v:[],d:[]};for(const a of prof.values())for(const k of Object.keys(profile))profile[k].push(a[k]);
  const events={t:[],p:[],s:[],r:[],r1:[],r5:[],r15:[]},horizon=[60,300,900];
  const lowerBound=(target,lo)=>{let hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows.get(mid,0)<target)lo=mid+1;else hi=mid;}return lo;};
  for(let i=0;i<rows.length;i++){
   const sec=rows.get(i,0),price=rows.get(i,1),size=rows.get(i,2),role=rows.get(i,3);if(size<220)continue;
   events.t.push(sec);events.p.push(price);events.s.push(size);events.r.push(role);
   for(let j=0;j<horizon.length;j++){const target=sec+horizon[j],ix=lowerBound(target,i+1),k=['r1','r5','r15'][j],valid=ix<rows.length&&rows.get(ix,0)-target<=30;events[k].push(valid?(rows.get(ix,1)/price-1)*100:null);}
  }
  const minuteBars=bars['1m'];let prev=null,prevTime=null,flow=[],rets=[];
  for(let i=0;i<minuteBars.t.length;i++){if(prev!==null&&prev!==0&&minuteBars.t[i]>prevTime&&minuteBars.t[i]-prevTime===60){flow.push(minuteBars.d[i]);rets.push((minuteBars.c[i]/prev-1)*100);}prev=minuteBars.c[i];prevTime=minuteBars.t[i];}
  const n=flow.length,mf=flow.reduce((a,v)=>a+v,0)/Math.max(1,n),mr=rets.reduce((a,v)=>a+v,0)/Math.max(1,n);let cv=0,vf=0,vr=0;
  for(let i=0;i<n;i++){const a=flow[i]-mf,b=rets[i]-mr;cv+=a*b;vf+=a*a;vr+=b*b;}
  const delta=buy-sell,metrics={date,row_count:rows.length,start_price:first,end_price:last,return_pct:first?(last/first-1)*100:0,low:low===-Infinity?0:low,high:high===-Infinity?0:high,range_pct:low>0?(high/low-1)*100:0,total_size:total,buy_size:buy,sell_size:sell,delta,imbalance_pct:total?delta/total*100:0,median_size:quant(.5),p90:quant(.9),p95:quant(.95),p99:quant(.99),max_size:maxSize,active_seconds_pct:active.size/86400*100,minute_flow_return_corr:n>=3&&vf&&vr?cv/Math.sqrt(vf*vr):null};
  return {metrics,bars,profile,hist,hist_labels:histLabels,events};
}

export { aggregateDay };
