// CSV parsing and timestamp normalization for Binance-style BTCUSD trade exports.
// Parsing has no DOM dependency; import cancellation and aggregation configuration are injected.
import { PackedTradeRows } from '../data/packed-trade-rows.js';
import { aggregateDay } from '../data/day-aggregator.js';

const DEFAULT_BAR_STEPS = {'10s':10,'1m':60,'5m':300,'15m':900,'1h':3600};
const DEFAULT_HIST_LABELS = ['1–9','10–24','25–49','50–99','100–219','220–671','672–999','1k–1.9k','2k+'];
const isoDate = ms => new Date(ms).toISOString().slice(0,10);

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
const fastTimestampDates=new Set();
function parseTradeTimestamp(stamp){
 const text=String(stamp||'').trim();
 if(text.length>=19&&(text[10]===' '||text[10]==='T')&&text[4]==='-'&&text[7]==='-'&&text[13]===':'&&text[16]===':'){
  const digitAt=i=>{const c=text.charCodeAt(i);return c>=48&&c<=57;};
  let digits=true;for(const i of [0,1,2,3,5,6,8,9,11,12,14,15,17,18])if(!digitAt(i)){digits=false;break;}
  const suffix=text.slice(19);let fastSuffix=!suffix;
  if(suffix&&suffix[0]==='.'&&suffix.length>1){fastSuffix=true;for(let i=1;i<suffix.length;i++){const c=suffix.charCodeAt(i);if(c<48||c>57){fastSuffix=false;break;}}}
  if(digits&&fastSuffix){
   const two=i=>(text.charCodeAt(i)-48)*10+(text.charCodeAt(i+1)-48),year=(text.charCodeAt(0)-48)*1000+(text.charCodeAt(1)-48)*100+(text.charCodeAt(2)-48)*10+(text.charCodeAt(3)-48),month=two(5),day=two(8),h=two(11),min=two(14),sec=two(17),date=text.slice(0,10);
   if(h>23||min>59||sec>59)throw new Error('Invalid calendar date or time "'+stamp+'".');
   if(!fastTimestampDates.has(date)){const midnight=Date.UTC(year,month-1,day);if(isoDate(midnight)!==date)throw new Error('Invalid calendar date or time "'+stamp+'".');fastTimestampDates.add(date);}
   const frac=suffix?Number('0'+suffix):0;return {date,sec:h*3600+min*60+sec+frac};
  }
 }
 const m=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(text);
 if(!m)throw new Error('Invalid timestamp "'+stamp+'". Expected YYYY-MM-DD HH:MM:SS[.fraction] with an optional timezone.');
 const date=m[1],ymd=date.split('-').map(Number),h=Number(m[2]),min=Number(m[3]),s=Number(m[4]),frac=m[5]?Number('0.'+m[5]):0,zone=(m[6]||'').toUpperCase();
 const midnight=Date.UTC(ymd[0],ymd[1]-1,ymd[2]);
 if(isoDate(midnight)!==date||h>23||min>59||s>59)throw new Error('Invalid calendar date or time "'+stamp+'".');
 let offset=0;if(zone&&zone!=='Z'){const z=/^([+-])(\d{2}):?(\d{2})$/.exec(zone);if(!z)throw new Error('Invalid timezone offset in "'+stamp+'".');const zh=Number(z[2]),zm=Number(z[3]);if(zh>14||zm>59||(zh===14&&zm!==0))throw new Error('Invalid timezone offset in "'+stamp+'".');offset=(zh*3600+zm*60)*(z[1]==='+'?1:-1);}
 const absolute=midnight/1000+h*3600+min*60+s+frac-offset,dayStart=Math.floor(absolute/86400)*86400;return {date:isoDate(dayStart*1000),sec:absolute-dayStart};
}

function createCsvDayParser({barSteps=DEFAULT_BAR_STEPS,histLabels=DEFAULT_HIST_LABELS,expectedSymbol='BTCUSD'}={}){
 const result=new Map();let lineNo=0,header=null,idx={},currentDate=null,rows=new PackedTradeRows(),rowCount=0,ordered=true,lastSec=-Infinity;
 const flush=()=>{if(currentDate!==null&&rows.length){result.set(currentDate,aggregateDay(currentDate,rows,ordered,barSteps,histLabels));rows=new PackedTradeRows();ordered=true;lastSec=-Infinity;}};
 const pushLine=rawLine=>{
  const line=String(rawLine).replace(/\r$/,'');if(!line.trim())return;lineNo++;
  const a=line.indexOf('"')<0?line.split(','):parseCsvRow(line);
  if(!header){header=a.map(x=>x.trim().toLowerCase());idx={price:header.indexOf('price'),size:header.indexOf('size'),timestamp:header.indexOf('timestamp'),role:header.indexOf('buyer_role'),product:header.indexOf('product_symbol')};if(idx.price<0||idx.size<0||idx.timestamp<0||idx.role<0)throw new Error('CSV needs price, size, timestamp and buyer_role columns.');return;}
  if(a.length<=Math.max(idx.price,idx.size,idx.timestamp,idx.role,idx.product))throw new Error('Malformed CSV row '+lineNo+': one or more required fields are missing.');
  const stamp=String(a[idx.timestamp]||'').trim();if(!stamp)throw new Error('Missing timestamp at CSV row '+lineNo+'.');
  const parsed=parseTradeTimestamp(stamp),date=parsed.date,sec=parsed.sec;
  const price=Number(String(a[idx.price]||'').trim()),size=Number(String(a[idx.size]||'').trim()),roleText=String(a[idx.role]||'').trim().toLowerCase();
  if(!Number.isFinite(price)||price<=0)throw new Error('Invalid price at CSV row '+lineNo+'. Prices must be positive numbers.');
  if(!Number.isFinite(size)||size<=0)throw new Error('Invalid size at CSV row '+lineNo+'. Sizes must be positive numbers.');
  if(roleText!=='taker'&&roleText!=='maker')throw new Error('Unknown buyer_role "'+roleText+'" at CSV row '+lineNo+'. Expected maker or taker; the file was not imported to avoid silently misclassifying flow.');
  if(idx.product>=0){const symbol=String(a[idx.product]||'').trim().toUpperCase();if(symbol!==expectedSymbol)throw new Error('This dashboard is for BTCUSD, but CSV row '+lineNo+' has product_symbol="'+symbol+'". Mixed or different symbols are not combined.');}
  const role=roleText==='taker'?1:0;
  if(currentDate===null)currentDate=date;
  if(date!==currentDate){flush();if(result.has(date))throw new Error('Rows in '+date+' are not contiguous after timestamp normalization. Please import chronologically sorted trade CSVs.');currentDate=date;}
  if(sec<lastSec)ordered=false;lastSec=sec;rows.push(sec,price,size,role);rowCount++;
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
    if(parser.rowCount-lastYieldRows>=25000){lastYieldRows=parser.rowCount;if(onProgress)onProgress(parser.rowCount,parser.currentDate,sourceName);await yieldToUi();if(importCancelRequested)throw new Error('Import cancelled by user.');}
   }
   pending=pending.slice(lineStart);
   if(done&&pending.length){parser.pushLine(pending);pending='';}
  }
  if(importCancelRequested)throw new Error('Import cancelled by user.');return parser.finish();
 }catch(err){try{await reader.cancel(err);}catch(_){}throw err;}finally{try{reader.releaseLock();}catch(_){}}
}

export { parseCsvRow, parseTradeTimestamp, createCsvDayParser, parseCsvByDay, parseCsvStreamByDay };
