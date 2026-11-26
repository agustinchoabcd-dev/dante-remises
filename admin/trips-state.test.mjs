import test from "node:test";
import assert from "node:assert/strict";
import { buildAdminTripHistoryModel, formatAdminTripPlace, formatAdminTripTime } from "./trips-state.mjs";

test("trip history orders actual records by update time", () => {
  const model=buildAdminTripHistoryModel({trips:{
    old:{status:"completed",passengerName:"Ana",createdAt:100,completedAt:300,updatedAt:300},
    active:{status:"in_progress",passengerName:"Luis",createdAt:200,updatedAt:250},
    pending:{status:"requested",passengerName:"Eva",createdAt:400,updatedAt:400}
  }});
  assert.equal(model.allCount,3);
  assert.deepEqual(model.rows.map(row=>row.id),["pending","old","active"]);
});

test("trip history filters by status and passenger, driver, car or route", () => {
  const trips={
    a:{status:"requested",passengerName:"María",driverName:"Dante",carId:"104",origin:{label:"Terminal"},destination:{label:"Hospital"},createdAt:10},
    b:{status:"completed",passengerName:"Pedro",driverName:"Marcelo",carId:"137",origin:{label:"Centro"},destination:{label:"Terminal"},createdAt:20}
  };
  assert.equal(buildAdminTripHistoryModel({trips,status:"requested"}).total,1);
  assert.equal(buildAdminTripHistoryModel({trips,query:"marcelo"}).rows[0].id,"b");
  assert.equal(buildAdminTripHistoryModel({trips,query:"Hospital"}).rows[0].id,"a");
  assert.equal(buildAdminTripHistoryModel({trips,query:"137"}).rows[0].id,"b");
});

test("trip history handles malformed timestamps and missing locations", () => {
  assert.equal(buildAdminTripHistoryModel({trips:{bad:{status:"unknown",createdAt:"not-a-date"}}}).rows[0].at,null);
  assert.equal(formatAdminTripPlace(null),"Ubicación no informada");
  assert.equal(formatAdminTripTime(null),"Fecha no disponible");
});
