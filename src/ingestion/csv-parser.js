// CSV parsing and timestamp normalization for Binance-style BTCUSD trade exports.
// Parsing has no DOM dependency; import cancellation and aggregation configuration are injected.
// The common Binance layout is parsed with a range-based fast path that avoids one
// array plus several substrings per row; anything unusual falls back to the general parser.
import { PackedTradeRows } from '../data/packed-trade-rows.js';
import { aggregateDay } from '../data/day-aggregator.js';

const DEFAULT_BAR_STEPS = {'10s':10,'1m':60,'5m':300,'15m':900,'1h':3600};
const DEFAULT_HIST_LABELS = ['1–9','10–24','25–49','50–99','100–219','220–671','672–999','1k–1.9k','2k+'];
const isoDate = ms => new Date(ms).toISOString().slice(0,10);
const POW10 = [1,10,100,1000,10000,100000,1000000,10000000,100000000,1000000000,10000000000,100000000000,1000000000000,10000000000000,100000000000000,1000000000000000];
// A numeric YYYYMMDD key avoids allocating a date substring for every trade print.
const validatedDateKeys = new Set();
let cachedDateKey = -1;
let cachedDateText = '';
let parsedDate = '';
let parsedSec = 0;

function parseCsvRow(line){
 const cells=[];let value='',quoted=false;
 for(let i=0;i<line.length;i++){
  const ch=line[i];
  if(ch==='"'){
   if(quoted&&line[i+1]==='"'){value+='"';i++;}
   else quoted=!quoted;
  }else if(ch===','&&!quoted){cells.push(value);value='';}
  else value+=ch;
 }
 if(quoted)throw new Error('Malformed CSV quoting. Check the source file near the row being imported.');
 cells.push(value);return cells;
}

function trimMaybe(text){
 const len=text.length;
 if(!len)return text;
 const first=text.charCodeAt(0),last=text.charCodeAt(len-1);
 if(first<=32||last<=32||first>127||last>127)return text.trim();
 return text;
}

const twoDigits=(text,i)=>{
 const a=text.charCodeAt(i)-48,b=text.charCodeAt(i+1)-48;
 return a>=0&&a<=9&&b>=0&&b<=9?a*10+b:-1;
};

// Fast path for `YYYY-MM-DD[ T]HH:MM:SS[.fraction]` without a timezone.
// Writes parsedDate/parsedSec and returns false for any other shape.
function parseTimestampRange(text,start,end){
 if(end-start<19)return false;
 if(text.charCodeAt(start+4)!==45||text.charCodeAt(start+7)!==45)return false;
 const separator=text.charCodeAt(start+10);
 if(separator!==32&&separator!==84)return false;
 if(text.charCodeAt(start+13)!==58||text.charCodeAt(start+16)!==58)return false;
 const y0=text.charCodeAt(start)-48,y1=text.charCodeAt(start+1)-48,y2=text.charCodeAt(start+2)-48,y3=text.charCodeAt(start+3)-48;
 if(y0<0||y0>9||y1<0||y1>9||y2<0||y2>9||y3<0||y3>9)return false;
 const month=twoDigits(text,start+5),day=twoDigits(text,start+8),hours=twoDigits(text,start+11),minutes=twoDigits(text,start+14),seconds=twoDigits(text,start+17);
 if(month<0||day<0||hours<0||minutes<0||seconds<0)return false;
 let fraction=0;
 if(end>start+19){
  if(text.charCodeAt(start+19)!==46)return false;
  const digits=end-(start+20);
  if(digits<1||digits>15)return false;
  for(let i=start+20;i<end;i++){const digit=text.charCodeAt(i)-48;if(digit<0||digit>9)return false;fraction=fraction*10+digit;}
  fraction/=POW10[digits];
 }
 if(hours>23||minutes>59||seconds>59)throw new Error('Invalid calendar date or time "'+text.slice(start,end)+'".');
 const year=((y0*10+y1)*10+y2)*10+y3,key=year*10000+month*100+day;
 if(key!==cachedDateKey){
  if(!validatedDateKeys.has(key)){
   const date=text.slice(start,start+10);
   if(isoDate(Date.UTC(year,month-1,day))!==date)throw new Error('Invalid calendar date or time "'+date+'".');
   validatedDateKeys.add(key);
  }
  cachedDateKey=key;cachedDateText=text.slice(start,start+10);
 }
 parsedDate=cachedDateText;parsedSec=hours*3600+minutes*60+seconds+fraction;
 return true;
}

// General timestamp parser: timezone offsets, arbitrary fractional digits, whitespace.
function parseTimestampSlow(stamp){
 const text=String(stamp||'').trim();
 const m=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(text);
 if(!m)throw new Error('Invalid timestamp "'+stamp+'". Expected YYYY-MM-DD HH:MM:SS[.fraction] with an optional timezone.');
 const date=m[1],ymd=date.split('-').map(Number),h=Number(m[2]),min=Number(m[3]),s=Number(m[4]),frac=m[5]?Number('0.'+m[5]):0,zone=(m[6]||'').toUpperCase();
 const midnight=Date.UTC(ymd[0],ymd[1]-1,ymd[2]);
 if(isoDate(midnight)!==date||h>23||min>59||s>59)throw new Error('Invalid calendar date or time "'+stamp+'".');
 // Unzoned values keep full fractional-second precision without epoch-sized intermediates.
 if(!zone||zone==='Z'){parsedDate=date;parsedSec=h*3600+min*60+s+frac;return;}
 const z=/^([+-])(\d{2}):?(\d{2})$/.exec(zone);if(!z)throw new Error('Invalid timezone offset in "'+stamp+'".');
 const zh=Number(z[2]),zm=Number(z[3]);if(zh>14||zm>59||(zh===14&&zm!==0))throw new Error('Invalid timezone offset in "'+stamp+'".');
 const offset=(zh*3600+zm*60)*(z[1]==='+'?1:-1);
 const absolute=midnight/1000+h*3600+min*60+s+frac-offset,dayStart=Math.floor(absolute/86400)*86400;
 parsedDate=isoDate(dayStart*1000);parsedSec=absolute-dayStart;
}

function parseTradeTimestamp(stamp){
 const text=trimMaybe(String(stamp||''));
 if(!parseTimestampRange(text,0,text.length))parseTimestampSlow(text);
 return {date:parsedDate,sec:parsedSec};
}

// Decimal parser for a field range. Values with at most 15 significant digits are
// computed exactly (integer < 2^53, one correctly rounded division), which matches
// Number(text) for the same input; anything else falls back to Number().
function parseNumberRange(text,start,end){
 while(start<end&&text.charCodeAt(start)<=32)start++;
 while(end>start&&text.charCodeAt(end-1)<=32)end--;
 if(start>=end)return NaN;
 let i=start,sign=1,c=text.charCodeAt(i);
 if(c===45){sign=-1;i++;}else if(c===43)i++;
 let integer=0,digits=0;
 while(i<end){c=text.charCodeAt(i);if(c<48||c>57)break;integer=integer*10+(c-48);digits++;i++;}
 let fraction=0,fracDigits=0;
 if(i<end&&text.charCodeAt(i)===46){
  i++;
  while(i<end){c=text.charCodeAt(i);if(c<48||c>57)break;fraction=fraction*10+(c-48);fracDigits++;digits++;i++;}
 }
 if(i!==end||digits===0||digits>15)return Number(text.slice(start,end));
 return sign*(integer*POW10[fracDigits]+fraction)/POW10[fracDigits];
}

// buyer_role comparison without allocating a lower-cased string for every print.
function roleFromLine(line,start){
 let end=line.length,beg=start;
 while(beg<end&&line.charCodeAt(beg)<=32)beg++;
 while(end>beg&&line.charCodeAt(end-1)<=32)end--;
 if(end-beg===5){
  const a=line.charCodeAt(beg)|32,b=line.charCodeAt(beg+1)|32,c=line.charCodeAt(beg+2)|32,d=line.charCodeAt(beg+3)|32,e=line.charCodeAt(beg+4)|32;
  if(a===116&&b===97&&c===107&&d===101&&e===114)return 1;
  if(a===109&&b===97&&c===107&&d===101&&e===114)return 0;
 }
 return -1;
}

function createCsvDayParser({barSteps=DEFAULT_BAR_STEPS,histLabels=DEFAULT_HIST_LABELS,expectedSymbol='BTCUSD'}={}){
 const result=new Map();let lineNo=0,header=null,idx={},currentDate=null,rows=new PackedTradeRows(),rowCount=0,ordered=true,lastSec=-Infinity,fastLayout=false;
 const flush=()=>{if(currentDate!==null&&rows.length){result.set(currentDate,aggregateDay(currentDate,rows,ordered,barSteps,histLabels));rows=new PackedTradeRows();ordered=true;lastSec=-Infinity;}};
 const commit=(date,sec,price,size,role)=>{
  if(currentDate===null)currentDate=date;
  if(date!==currentDate){flush();if(result.has(date))throw new Error('Trades for '+date+' are not contiguous after timestamp normalization. Import CSV files with trades sorted chronologically.');currentDate=date;}
  if(sec<lastSec)ordered=false;lastSec=sec;rows.push(sec,price,size,role);rowCount++;
 };
 const pushGeneralLine=line=>{
  const a=line.indexOf('"')<0?line.split(','):parseCsvRow(line);
  if(a.length<=Math.max(idx.price,idx.size,idx.timestamp,idx.role,idx.product))throw new Error('Malformed CSV row '+lineNo+': one or more required fields are missing.');
  const stamp=String(a[idx.timestamp]||'').trim();if(!stamp)throw new Error('Missing timestamp at CSV row '+lineNo+'.');
  parseTradeTimestamp(stamp);
  const price=Number(String(a[idx.price]||'').trim()),size=Number(String(a[idx.size]||'').trim()),roleText=String(a[idx.role]||'').trim().toLowerCase();
  if(!Number.isFinite(price)||price<=0)throw new Error('Invalid price at CSV row '+lineNo+'. Prices must be positive numbers.');
  if(!Number.isFinite(size)||size<=0)throw new Error('Invalid size at CSV row '+lineNo+'. Sizes must be positive numbers.');
  if(roleText!=='taker'&&roleText!=='maker')throw new Error('Unknown buyer_role "'+roleText+'" at CSV row '+lineNo+'. Expected maker or taker; the file was not imported to avoid silently misclassifying flow.');
  if(idx.product>=0){const symbol=String(a[idx.product]||'').trim().toUpperCase();if(symbol!==expectedSymbol)throw new Error('This dashboard is for BTCUSD, but CSV row '+lineNo+' has product_symbol="'+symbol+'". Mixed or different symbols are not combined.');}
  commit(parsedDate,parsedSec,price,size,roleText==='taker'?1:0);
 };
 const pushFastLine=line=>{
  const p1=line.indexOf(',');if(p1<0)return false;
  const p2=line.indexOf(',',p1+1);if(p2<0)return false;
  const p3=line.indexOf(',',p2+1);if(p3<0)return false;
  const p4=line.indexOf(',',p3+1);if(p4<0||line.indexOf(',',p4+1)>=0)return false;
  if(!parseTimestampRange(line,p3+1,p4)){
   const stamp=trimMaybe(line.slice(p3+1,p4));if(!stamp)throw new Error('Missing timestamp at CSV row '+lineNo+'.');
   parseTimestampSlow(stamp);
  }
  const price=parseNumberRange(line,p1+1,p2),size=parseNumberRange(line,p2+1,p3);
  if(!Number.isFinite(price)||price<=0)throw new Error('Invalid price at CSV row '+lineNo+'. Prices must be positive numbers.');
  if(!Number.isFinite(size)||size<=0)throw new Error('Invalid size at CSV row '+lineNo+'. Sizes must be positive numbers.');
  const role=roleFromLine(line,p4+1);
  if(role<0){const roleText=String(line.slice(p4+1)||'').trim().toLowerCase();throw new Error('Unknown buyer_role "'+roleText+'" at CSV row '+lineNo+'. Expected maker or taker; the file was not imported to avoid silently misclassifying flow.');}
  if(idx.product>=0&&(p1!==expectedSymbol.length||!line.startsWith(expectedSymbol))){
   const symbol=String(line.slice(0,p1)||'').trim().toUpperCase();
   if(symbol!==expectedSymbol)throw new Error('This dashboard is for BTCUSD, but CSV row '+lineNo+' has product_symbol="'+symbol+'". Mixed or different symbols are not combined.');
  }
  commit(parsedDate,parsedSec,price,size,role);
  return true;
 };
 const pushLine=rawLine=>{
  let line=typeof rawLine==='string'?rawLine:String(rawLine);
  if(line.charCodeAt(line.length-1)===13)line=line.slice(0,-1);
  if(!line)return;
  if(line.charCodeAt(0)<=32&&!line.trim())return;
  lineNo++;
  if(!header){
   const head=line.indexOf('"')<0?line.split(','):parseCsvRow(line);
   header=head.map(x=>x.trim().toLowerCase());
   idx={price:header.indexOf('price'),size:header.indexOf('size'),timestamp:header.indexOf('timestamp'),role:header.indexOf('buyer_role'),product:header.indexOf('product_symbol')};
   if(idx.price<0||idx.size<0||idx.timestamp<0||idx.role<0)throw new Error('The CSV must contain the price, size, timestamp, and buyer_role columns.');
   fastLayout=idx.product===0&&idx.price===1&&idx.size===2&&idx.timestamp===3&&idx.role===4&&header.length===5;
   return;
  }
  if(fastLayout&&line.indexOf('"')<0&&pushFastLine(line))return;
  pushGeneralLine(line);
 };
 return {pushLine,finish(){flush();if(!result.size)throw new Error('No valid trade rows were found in this file.');return result;},get rowCount(){return rowCount;},get currentDate(){return currentDate;},get lineNo(){return lineNo;}};
}
function parseCsvByDay(text,options={}){
 const parser=createCsvDayParser(options);let pos=0;
 while(pos<text.length){let end=text.indexOf('\n',pos);if(end<0)end=text.length;parser.pushLine(text.slice(pos,end));pos=end+1;}
 return parser.finish();
}
const yieldToUi=()=>new Promise(resolve=>setTimeout(resolve,0));
async function parseCsvStreamByDay(readable,sourceName,onProgress,shouldCancel=()=>false,options={}){
 const parser=createCsvDayParser(options),reader=readable.getReader(),decoder=new TextDecoder();let pending='',lastYieldRows=0,done=false;
 try{
  while(!done){if(shouldCancel())throw new Error('Import cancelled by user.');const item=await reader.read();done=item.done;if(item.value)pending+=decoder.decode(item.value,{stream:!done});else if(done)pending+=decoder.decode();
   let lineStart=0,lf;
   while((lf=pending.indexOf('\n',lineStart))!==-1){parser.pushLine(pending.slice(lineStart,lf));lineStart=lf+1;
    if(parser.rowCount-lastYieldRows>=25000){lastYieldRows=parser.rowCount;if(onProgress)onProgress(parser.rowCount,parser.currentDate,sourceName);await yieldToUi();if(shouldCancel())throw new Error('Import cancelled by user.');}
   }
   pending=pending.slice(lineStart);
   if(done&&pending.length){parser.pushLine(pending);pending='';}
  }
  if(shouldCancel())throw new Error('Import cancelled by user.');return parser.finish();
 }catch(err){try{await reader.cancel(err);}catch(_){}throw err;}finally{try{reader.releaseLock();}catch(_){}}
}

export { parseCsvRow, parseTradeTimestamp, createCsvDayParser, parseCsvByDay, parseCsvStreamByDay };
