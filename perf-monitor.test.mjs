import test from "node:test";
import assert from "node:assert/strict";
import {createPerformanceMonitor} from "./perf-monitor.mjs";

test("records synchronous measurements and returns callback values",()=>{
 const p=createPerformanceMonitor({exposeGlobal:false,observeLongTasks:false});
 assert.equal(p.measure("test.sync",()=>42),42);
 const x=p.summary().find(v=>v.name==="test.sync");
 assert.equal(x.count,1);
 assert.ok(x.maxMs>=0);
});

test("records asynchronous measurements and rejected promises",async()=>{
 const p=createPerformanceMonitor({exposeGlobal:false,observeLongTasks:false});
 assert.equal(await p.measureAsync("test.async",async()=>"ok"),"ok");
 await assert.rejects(p.measureAsync("test.failure",async()=>{throw new Error("expected")}),/expected/);
 assert.equal(p.summary().find(v=>v.name==="test.async").count,1);
 assert.equal(p.summary().find(v=>v.name==="test.failure").count,1);
});

test("bounds in-memory history and filters non-numeric details",()=>{
 const p=createPerformanceMonitor({maxEntries:2,exposeGlobal:false,observeLongTasks:false});
 p.mark("test.mark",{count:4,label:"not retained"});
 assert.deepEqual(p.records[0].details,{count:4});
 p.measure("test.one",()=>{});
 p.measure("test.two",()=>{});
 assert.equal(p.records.length,2);
 assert.equal(p.records[0].name,"test.one");
 assert.deepEqual(p.records[0].details,{failed:0});
});
