// ZIP archive directory validation and streaming CSV entry reader.
// Intentionally has no UI or dashboard-state dependencies so it can be tested alone.
async function zipCsvEntries(file){
 const tailStart=Math.max(0,file.size-65557),tailBytes=new Uint8Array(await file.slice(tailStart).arrayBuffer()),tailView=new DataView(tailBytes.buffer,tailBytes.byteOffset,tailBytes.byteLength);let eocd=-1;
 for(let i=tailBytes.length-22;i>=Math.max(0,tailBytes.length-65557);i--){if(tailView.getUint32(i,true)===0x06054b50&&i+22<=tailBytes.length&&i+22+tailView.getUint16(i+20,true)===tailBytes.length){eocd=i;break;}}
 if(eocd<0)throw new Error('Could not read ZIP directory in '+file.name+'.');
 const disk=tailView.getUint16(eocd+4,true),dirDisk=tailView.getUint16(eocd+6,true),diskCount=tailView.getUint16(eocd+8,true),count=tailView.getUint16(eocd+10,true),dirSize=tailView.getUint32(eocd+12,true),dirOffset=tailView.getUint32(eocd+16,true);
 if(disk!==0||dirDisk!==0||diskCount!==count)throw new Error('Multi-disk ZIP archives are not supported.');
 if(count===0xffff||dirSize===0xffffffff||dirOffset===0xffffffff)throw new Error('ZIP64 archives are not supported by this browser importer. Extract the CSV and import it directly instead.');
 const directoryEnd=dirOffset+dirSize,eocdOffset=tailStart+eocd;
 if(directoryEnd>file.size||directoryEnd>eocdOffset)throw new Error('ZIP directory points outside the uploaded file or overlaps its end record.');
 const out=[];let off=dirOffset;
 for(let n=0;n<count;n++){
  if(off+46>directoryEnd)throw new Error('ZIP directory entry exceeds the declared directory size in '+file.name+'.');
  const fixedBytes=new Uint8Array(await file.slice(off,off+46).arrayBuffer());if(fixedBytes.length!==46)throw new Error('Truncated ZIP directory entry in '+file.name+'.');
  const h=new DataView(fixedBytes.buffer,fixedBytes.byteOffset,fixedBytes.byteLength);if(h.getUint32(0,true)!==0x02014b50)throw new Error('Invalid ZIP directory entry in '+file.name+'.');
  const flags=h.getUint16(8,true),method=h.getUint16(10,true),compSize=h.getUint32(20,true),uncompSize=h.getUint32(24,true),nameLen=h.getUint16(28,true),extraLen=h.getUint16(30,true),commentLen=h.getUint16(32,true),localOff=h.getUint32(42,true);
  const entryEnd=off+46+nameLen+extraLen+commentLen;if(entryEnd>directoryEnd)throw new Error('ZIP directory entry lengths exceed the declared directory size in '+file.name+'.');
  const nameBytes=await file.slice(off+46,off+46+nameLen).arrayBuffer(),name=new TextDecoder().decode(nameBytes);off=entryEnd;
  if(name.endsWith('/')||!name.toLowerCase().endsWith('.csv'))continue;
  if(flags&1)throw new Error('Encrypted ZIP entries are not supported ('+name+').');
  if(compSize===0xffffffff||uncompSize===0xffffffff||localOff===0xffffffff)throw new Error('ZIP64 CSV entry is not supported ('+name+').');
  out.push({name,method,flags,compSize,uncompSize,localOff,directoryOffset:dirOffset});
 }
 if(off>directoryEnd)throw new Error('ZIP directory entries exceed the declared directory size in '+file.name+'.');
 if(!out.length)throw new Error('No .csv file found inside '+file.name+'.');
 return out;
}
async function zipEntryStream(file,entry){
 const b=new Uint8Array(await file.slice(entry.localOff,entry.localOff+30).arrayBuffer());if(b.length!==30)throw new Error('Truncated ZIP local header for '+entry.name+'.');
 const h=new DataView(b.buffer,b.byteOffset,b.byteLength);if(h.getUint32(0,true)!==0x04034b50)throw new Error('Invalid ZIP local header for '+entry.name+'.');
 const localFlags=h.getUint16(6,true),localMethod=h.getUint16(8,true),nameLen=h.getUint16(26,true),extraLen=h.getUint16(28,true);
 if(localFlags&1)throw new Error('Encrypted ZIP entries are not supported ('+entry.name+').');
 if(localMethod!==entry.method)throw new Error('ZIP compression metadata mismatch for '+entry.name+'.');
 if(entry.localOff>=entry.directoryOffset)throw new Error('ZIP local header overlaps the central directory for '+entry.name+'.');
 const localNameBytes=new Uint8Array(await file.slice(entry.localOff+30,entry.localOff+30+nameLen).arrayBuffer()),localName=new TextDecoder().decode(localNameBytes);
 if(localName!==entry.name)throw new Error('ZIP local filename does not match its directory entry for '+entry.name+'.');
 const dataStart=entry.localOff+30+nameLen+extraLen,dataEnd=dataStart+entry.compSize;if(dataStart<entry.localOff+30||dataEnd>entry.directoryOffset||dataEnd>file.size)throw new Error('Compressed data bounds are invalid for '+entry.name+'.');
 let stream=file.slice(dataStart,dataEnd).stream();
 if(entry.method===8){if(typeof DecompressionStream==='undefined')throw new Error('This browser cannot stream-decompress ZIP files. Please use current Chrome or Edge.');try{stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));}catch(err){throw new Error('This browser does not support raw DEFLATE ZIP streams. Please use current Chrome or Edge.');}}
 else if(entry.method!==0)throw new Error('ZIP compression method '+entry.method+' is not supported for '+entry.name+'.');
 return stream;
}

export { zipCsvEntries, zipEntryStream };
