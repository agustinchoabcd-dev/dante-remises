import test from "node:test";
import assert from "node:assert/strict";
import { buildAdminStaffModel, filterAdminStaffRows } from "./staff-state.mjs";

test("staff model separates roles and maps actual car availability", () => {
  const rows=buildAdminStaffModel({
    staff:[
      {uid:"admin",name:"Agustín Lasala",role:"admin",carId:"144"},
      {uid:"driver",name:"Dante Arias",role:"driver",carId:"104"},
      {uid:"operator",name:"Patricia Ávila",role:"operator"}
    ],
    cars:[
      {id:"144",model:"Fiat Cronos",online:true,status:"libre"},
      {id:"104",model:"Fiat Cronos",online:false,status:"libre"}
    ]
  });
  assert.deepEqual(rows.map(row=>row.role),["admin","driver","operator"]);
  assert.equal(rows[0].statusLabel,"Libre");
  assert.equal(rows[1].statusLabel,"Desconectado");
  assert.match(rows[2].statusLabel,/no consultada/);
});

test("staff search matches name, role and vehicle", () => {
  const rows=buildAdminStaffModel({staff:[
    {uid:"1",name:"Marcelo Avellaneda",role:"driver",carId:"137"},
    {uid:"2",name:"Patricia Ávila",role:"operator"}
  ],cars:[{id:"137",model:"Chery Tiggo",online:true,status:"ocupado"}]});
  assert.equal(filterAdminStaffRows(rows,"Chery").length,1);
  assert.equal(filterAdminStaffRows(rows,"operador")[0].name,"Patricia Ávila");
  assert.equal(filterAdminStaffRows(rows,"inexistente").length,0);
});

test("unknown roles are not included in the staff directory", () => {
  assert.deepEqual(buildAdminStaffModel({staff:[
    {uid:"p",name:"Pasajero",role:"passenger"},
    {uid:"x",name:"Desconocido",role:"unknown"}
  ]}),[]);
});
