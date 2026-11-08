const DEFAULT_LIMIT=300;
function percentile(values,fraction){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*fraction)-1)]}
export function createPerformanceMonitor({maxEntries=DEFAULT_LIMIT,exposeGlobal=true,observeLongTasks=true}={}){
 const now=()=>globalThis.performance?.now?.()??Date.now(),records=[];let observer=null;
 function push(entry){records.push(entry);if(records.length>maxEntries)records.splice(0,records.length-maxEntries);return entry}
 function safe(details){const out={};for(const [k,v] of Object.entries(details||{}))if(typeof v==="number"&&Number.isFinite(v))out[k]=v;return out}
 function mark(name,details={}){return push({type:"mark",name:String(name),atMs:now(),details:safe(details)})}
 function record(name,start,end=now(),details={}){return push({type:"measure",name:String(name),durationMs:Math.max(0,Number(end)-Number(start)),atMs:Number(end),details:safe(details)})}
 function measure(name,fn){const start=now();let failed=0;try{return fn()}catch(error){failed=1;throw error}finally{record(name,start,now(),{failed})}}
 async function measureAsync(name,fn){const start=now();let failed=0;try{return await fn()}catch(error){failed=1;throw error}finally{record(name,start,now(),{failed})}}
 function summary(){const groups=new Map();for(const x of records)if(x.type==="measure"){const v=groups.get(x.name)||[];v.push(x.durationMs);groups.set(x.name,v)}return [...groups].map(([name,v])=>({name,count:v.length,avgMs:Number((v.reduce((s,n)=>s+n,0)/v.length).toFixed(2)),p50Ms:Number(percentile(v,.5).toFixed(2)),p95Ms:Number(percentile(v,.95).toFixed(2)),maxMs:Number(Math.max(...v).toFixed(2))})).sort((x,y)=>y.p95Ms-x.p95Ms)}
 function report(){const result={summary:summary(),marks:records.filter(x=>x.type==="mark"),longTasks:records.filter(x=>x.name==="browser.longtask"),totalRecords:records.length};if(globalThis.console?.table)console.table(result.summary);if(globalThis.console?.log)console.log("Dante performance marks:",result.marks);return result}
 function exportJSON(){return JSON.stringify({summary:summary(),records},null,2)}
 function clear(){records.length=0}
 const api={mark,record,measure,measureAsync,summary,report,exportJSON,clear,get records(){return records.map(x=>({...x,details:{...x.details}}))}};
 if(observeLongTasks&&typeof globalThis.PerformanceObserver==="function"){try{observer=new PerformanceObserver(list=>{for(const e of list.getEntries())record("browser.longtask",e.startTime,e.startTime+e.duration)});observer.observe({entryTypes:["longtask"]})}catch{observer?.disconnect?.();observer=null}}
 if(exposeGlobal&&globalThis.window){try{Object.defineProperty(globalThis.window,"__DANTE_PERF__",{configurable:true,value:api})}catch{}}
 return api
}
export const performanceMonitor=createPerformanceMonitor();
