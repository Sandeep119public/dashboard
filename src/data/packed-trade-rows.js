// Packed numeric storage for one day's raw trade prints.
// Columns: timestamp seconds, price, size, buyer role (0/1).
export class PackedTradeRows {
 constructor(capacity=16384){this.count=0;this.data=new Float64Array(capacity*4);}
 get length(){return this.count;}
 get(i,column){return this.data[i*4+column];}
 push(sec,price,size,role){
  if((this.count+1)*4>this.data.length){const next=new Float64Array(Math.max(16384*4,this.data.length*2));next.set(this.data.subarray(0,this.count*4));this.data=next;}
  const i=this.count*4;this.data[i]=sec;this.data[i+1]=price;this.data[i+2]=size;this.data[i+3]=role;this.count++;
 }
 sortByTimestamp(){
  if(this.count<2)return;
  // Typed indices avoid the large boxed-number array used by Array(count) on unsorted imports.
  const order=new Uint32Array(this.count);for(let i=0;i<this.count;i++)order[i]=i;
  order.sort((a,b)=>this.data[a*4]-this.data[b*4]);
  const sorted=new Float64Array(this.count*4);
  for(let i=0;i<order.length;i++){const from=order[i]*4,to=i*4;sorted[to]=this.data[from];sorted[to+1]=this.data[from+1];sorted[to+2]=this.data[from+2];sorted[to+3]=this.data[from+3];}
  this.data=sorted;
 }
}
