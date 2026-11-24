import test from "node:test";
import assert from "node:assert/strict";
import { getDriverHomeStatus, shouldRegisterDriverPresence, shouldExpandDriverCurtain, nextDriverHomeMessage, formatDriverTripPlace, formatDriverCardDistance, getDriverRequestRouteDistances, validateDriverLocationFix } from "./driver-home-state.mjs";
test("driver home status maps the requested states",()=>{
 assert.deepEqual(getDriverHomeStatus({online:false,status:"libre"}),{label:"Desconectado",tone:"red",badge:""});
 assert.deepEqual(getDriverHomeStatus({online:true,status:"libre"}),{label:"Conectado",tone:"green",badge:""});
 assert.deepEqual(getDriverHomeStatus({online:true,status:"ocupado"}),{label:"Conectado",tone:"orange",badge:"Ocupado"});
 assert.deepEqual(getDriverHomeStatus({online:true,status:"fuera"}),{label:"Conectado",tone:"red",badge:"Fuera de servicio"});
});
test("driver presence is manual for drivers and admin, except while a trip is active",()=>{
 assert.equal(shouldRegisterDriverPresence("admin",false,false),false);
 assert.equal(shouldRegisterDriverPresence("admin",true,false),true);
 assert.equal(shouldRegisterDriverPresence("admin",false,true),true);
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
 assert.equal(formatDriverTripPlace({placeName:"YPF",street:"Ruta Provincial 5",label:"YPF, Ruta Provincial 5, Santa Rosa de Calamuchita, Córdoba, Argentina"}),"YPF, Ruta Provincial 5");
 assert.equal(formatDriverTripPlace({placeName:"YPF",addressLine1:"YPF, Ruta Provincial 5, Santa Rosa de Calamuchita, Córdoba, Argentina"}),"YPF, Ruta Provincial 5");
 assert.equal(formatDriverTripPlace({street:"Avenida Libertad",houseNumber:"123",label:"Avenida Libertad 123, 5196 Santa Rosa de Calamuchita, Córdoba, Argentina"}),"Avenida Libertad 123");
 assert.equal(formatDriverTripPlace({label:"Ruta 5, Santa Rosa de Calamuchita, Córdoba, Argentina"}),"Ruta 5");
 assert.equal(formatDriverTripPlace({label:"5196 Santa Rosa de Calamuchita, Córdoba, Argentina"}),"Ubicación sin referencia");
});

test("driver trip address formatting removes coordinate pairs",()=>{
 assert.equal(formatDriverTripPlace({label:"Supermercado Becerra, España 95, -32.1234,-64.5678, Santa Rosa de Calamuchita, Argentina"}),"Supermercado Becerra, España 95");
 assert.equal(formatDriverTripPlace({label:"-32.1234,-64.5678, Argentina"}),"Ubicación sin referencia");
});

test("driver request card distances are always shown in kilometres",()=>{
 assert.equal(formatDriverCardDistance(500),"0.5 km");
 assert.equal(formatDriverCardDistance(1200),"1.2 km");
 assert.equal(formatDriverCardDistance(0),"0.0 km");
 assert.equal(formatDriverCardDistance(-1),"Distancia no disponible");
 assert.equal(formatDriverCardDistance("bad"),"Distancia no disponible");
});

test("driver request route distances use the two road legs and reject missing values",()=>{
 assert.deepEqual(getDriverRequestRouteDistances({legs:[{distance:850},{distance:1250}]}),{pickupMeters:850,destinationMeters:1250,totalRouteMeters:2100,legDistances:[850,1250]});
 assert.deepEqual(getDriverRequestRouteDistances({legs:[{distance:850},{distance:1250},{distance:600}]}),{pickupMeters:850,destinationMeters:1850,totalRouteMeters:2700,legDistances:[850,1250,600]});
 assert.deepEqual(getDriverRequestRouteDistances({legs:[{distance:850}]}),{pickupMeters:850,destinationMeters:null,totalRouteMeters:850,legDistances:[850]});
 assert.deepEqual(getDriverRequestRouteDistances({legs:[{distance:-1},{distance:"bad"}]}),{pickupMeters:null,destinationMeters:null,totalRouteMeters:null,legDistances:[null,null]});
 assert.deepEqual(getDriverRequestRouteDistances({legs:[{distance:null},{distance:undefined}]}),{pickupMeters:null,destinationMeters:null,totalRouteMeters:null,legDistances:[null,null]});
});

test("driver GPS accepts recent accurate fixes and preserves their real timestamp",()=>{
 const fix=validateDriverLocationFix({timestamp:1_800_000_000_000,coords:{latitude:-32.07,longitude:-64.53,accuracy:8,heading:90,speed:12}},{now:1_800_000_001_000});
 assert.equal(fix.accepted,true);
 assert.deepEqual(fix.location,{lat:-32.07,lon:-64.53,accuracy:8,heading:90,speed:12,updatedAt:1_800_000_000_000});
 assert.equal(fix.ageMs,1000);
});
test("driver GPS rejects inaccurate, stale and invalid fixes",()=>{
 const now=1_800_000_000_000;
 assert.equal(validateDriverLocationFix({timestamp:now,coords:{latitude:-32,longitude:-64,accuracy:180}},{now}).reason,"poor_accuracy");
 assert.equal(validateDriverLocationFix({timestamp:now-31_000,coords:{latitude:-32,longitude:-64,accuracy:10}},{now}).reason,"stale_fix");
 assert.equal(validateDriverLocationFix({timestamp:now,coords:{latitude:91,longitude:-64,accuracy:10}},{now}).reason,"invalid_coordinates");
});
test("driver GPS rejects impossible jumps but accepts plausible vehicle movement",()=>{
 const now=1_800_000_000_000;
 const previous={lat:-32.0700,lon:-64.5300,accuracy:8,updatedAt:now-5_000};
 const jump=validateDriverLocationFix({timestamp:now,coords:{latitude:-32.0900,longitude:-64.5300,accuracy:8}},{now,previous});
 assert.equal(jump.accepted,false);
 assert.equal(jump.reason,"implausible_jump");
 const normal=validateDriverLocationFix({timestamp:now,coords:{latitude:-32.0705,longitude:-64.5300,accuracy:8}},{now,previous});
 assert.equal(normal.accepted,true);
});
