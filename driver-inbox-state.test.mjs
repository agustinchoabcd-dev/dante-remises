import test from "node:test";
import assert from "node:assert/strict";
import { getPendingDriverInboxEntries, loadPendingDriverTrips } from "./driver-inbox-state.mjs";

test("filters malformed and non-requested inbox entries",()=>{
 assert.deepEqual(getPendingDriverInboxEntries({
  a:{tripId:"trip-a",status:"requested"},
  b:{tripId:"trip-b",status:"accepted"},
  c:null,
  d:{status:"requested"},
  e:{tripId:"",status:"requested"}
 }),[{inboxKey:"a",tripId:"trip-a"}]);
});

test("loads requested trip records concurrently and omits stale records",async()=>{
 let active=0,maxActive=0;
 const trips=await loadPendingDriverTrips({
  a:{tripId:"trip-a",status:"requested"},
  b:{tripId:"trip-b",status:"requested"},
  c:{tripId:"trip-c",status:"requested"}
 },async id=>{
  active++;maxActive=Math.max(maxActive,active);
  await Promise.resolve();
  active--;
  return id==="trip-b"?{status:"accepted"}:{status:"requested",passengerName:id};
 });
 assert.equal(maxActive,3);
 assert.deepEqual(trips,[
  {status:"requested",passengerName:"trip-a",tripId:"trip-a"},
  {status:"requested",passengerName:"trip-c",tripId:"trip-c"}
 ]);
});

test("propagates failed reads so the UI can report and recover",async()=>{
 await assert.rejects(loadPendingDriverTrips({a:{tripId:"trip-a",status:"requested"}},async()=>{throw new TypeError("read failed")}),/read failed/);
});
