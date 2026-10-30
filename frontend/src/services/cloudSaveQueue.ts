/** One writer per page. Failed saves keep the latest complete local snapshot. */
export type CloudSaveState = 'saving' | 'pending' | 'synced' | 'blocked'
export class CloudSaveQueue<T> {
 private pending: {value:T;version:number}|null=null
 private running=false
 private disposed=false
 private timer:ReturnType<typeof setTimeout>|undefined
 private version=0
 private failures=0
 private send:(value:T)=>Promise<void>
 private report:(state:CloudSaveState,error?:unknown)=>void
 private retryable:(error:unknown)=>boolean
 constructor(send:(value:T)=>Promise<void>,report:(state:CloudSaveState,error?:unknown)=>void,retryable:(error:unknown)=>boolean){this.send=send;this.report=report;this.retryable=retryable}
 enqueue(value:T){
  this.pending={value,version:++this.version}
  this.failures=0
  this.cancelTimer()
  void this.drain()
 }
 retry(){this.cancelTimer();void this.drain()}
 dispose(){this.disposed=true;this.cancelTimer()}
 private cancelTimer(){if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined}
 private async drain(){
  if(this.running||this.disposed||!this.pending)return
  this.running=true
  try{
   while(this.pending&&!this.disposed){
    const task:{value:T;version:number}=this.pending
    this.report('saving')
    try{
     await this.send(task.value)
     if(this.disposed)return
     this.failures=0
     if(this.pending?.version===task.version)this.pending=null
     if(!this.pending)this.report('synced')
    }catch(error){
     if(this.disposed)return
     const automatic=this.retryable(error)
     this.report(automatic?'pending':'blocked',error)
     if(automatic){
      const delay=Math.min(60000,5000*2**Math.min(this.failures++,4))
      this.timer=setTimeout(()=>{this.timer=undefined;void this.drain()},delay)
     }
     return
    }
   }
  }finally{this.running=false}
 }
}
