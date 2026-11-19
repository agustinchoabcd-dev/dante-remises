import test from "node:test";
import assert from "node:assert/strict";
import { getDriverHomeStatus, shouldRegisterDriverPresence, shouldExpandDriverCurtain, nextDriverHomeMessage, formatDriverTripPlace, getDriverRequestRouteDistances } from "./driver-home-state.mjs";
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
 assert.equal(shouldExpandDriverCurtain({expanded:false,deltaY:-360,viewportHeight:800}),false);
 assert.equal(shouldExpandDriverCurtain({expanded:false,deltaY:-361,viewportHeight:800}),true);
 assert.equal(shouldExpandDriverCurtain({expanded:true,deltaY:359,viewportHeight:800}),true);
 assert.equal(shouldExpandDriverCurtain({expanded:true,deltaY:360,viewportHeight:800}),true);
 assert.equal(shouldExpandDriverCurtain({expanded:true,deltaY:361,viewportHeight:800}),false);
});
test("connected message alternates between the two requested labels",()=>{
 assert.equal(nextDriverHomeMessage("Estás conectado"),"Buscando solicitud de viaje");
 assert.equal(nextDriverHomeMessage("Buscando solicitud de viaje"),"Estás conectado");
});

test("driver trip addresses prefer place name and street details without administrative data",()=>{
 assert.equal(formatDriverTripPlace({placeName:"YPF",street:"Ruta Provincial 5",label:"YPF, Ruta Provincial 5, Santa Rosa de Calamuchita, Córdoba, Argentina"}),"YPF · Ruta Provincial 5");
 assert.equal(formatDriverTripPlace({street:"Avenida Libertad",houseNumber:"123",label:"Avenida Libertad 123, 5196 Santa Rosa de Calamuchita, Córdoba, Argentina"}),"Avenida Libertad 123");
 assert.equal(formatDriverTripPlace({label:"Ruta 5, Santa Rosa de Calamuchita, Córdoba, Argentina"}),"Ruta 5");
 assert.equal(formatDriverTripPlace({label:"5196 Santa Rosa de Calamuchita, Córdoba, Argentina"}),"Ubicación sin referencia");
});

test("driver request route distances use the two road legs and reject missing values",()=>{
 assert.deepEqual(getDriverRequestRouteDistances({legs:[{distance:850},{distance:1250}]}),{pickupMeters:850,destinationMeters:1250});
 assert.deepEqual(getDriverRequestRouteDistances({legs:[{distance:850}]}),{pickupMeters:850,destinationMeters:null});
 assert.deepEqual(getDriverRequestRouteDistances({legs:[{distance:-1},{distance:"bad"}]}),{pickupMeters:null,destinationMeters:null});
 assert.deepEqual(getDriverRequestRouteDistances({legs:[{distance:null},{distance:undefined}]}),{pickupMeters:null,destinationMeters:null});
});
