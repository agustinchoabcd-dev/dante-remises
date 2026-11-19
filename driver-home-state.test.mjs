import test from "node:test";
import assert from "node:assert/strict";
import { getDriverHomeStatus, shouldRegisterDriverPresence, shouldExpandDriverCurtain, nextDriverHomeMessage } from "./driver-home-state.mjs";
test("driver home status maps the requested states",()=>{
 assert.deepEqual(getDriverHomeStatus({online:false,status:"libre"}),{label:"Desconectado",tone:"red",badge:""});
 assert.deepEqual(getDriverHomeStatus({online:true,status:"libre"}),{label:"Conectado",tone:"green",badge:""});
 assert.deepEqual(getDriverHomeStatus({online:true,status:"ocupado"}),{label:"Conectado",tone:"orange",badge:"Ocupado"});
 assert.deepEqual(getDriverHomeStatus({online:true,status:"fuera"}),{label:"Conectado",tone:"red",badge:"Fuera de servicio"});
});
test("driver presence is opt-in; Admin keeps automatic presence",()=>{
 assert.equal(shouldRegisterDriverPresence("admin",false,false),true);
 assert.equal(shouldRegisterDriverPresence("driver",false,false),false);
 assert.equal(shouldRegisterDriverPresence("driver",true,false),true);
 assert.equal(shouldRegisterDriverPresence("driver",false,true),true);
 assert.equal(shouldRegisterDriverPresence("operator",true,true),false);
});
test("curtain uses the 45 percent viewport threshold in both directions",()=>{
 assert.equal(shouldExpandDriverCurtain({expanded:false,deltaY:-359,viewportHeight:800}),false);
 assert.equal(shouldExpandDriverCurtain({expanded:false,deltaY:-360,viewportHeight:800}),true);
 assert.equal(shouldExpandDriverCurtain({expanded:true,deltaY:359,viewportHeight:800}),true);
 assert.equal(shouldExpandDriverCurtain({expanded:true,deltaY:360,viewportHeight:800}),false);
});
test("connected message alternates between the two requested labels",()=>{
 assert.equal(nextDriverHomeMessage("Estás conectado"),"Buscando solicitud de viaje");
 assert.equal(nextDriverHomeMessage("Buscando solicitud de viaje"),"Estás conectado");
});