import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const [html, nativeBridge, webBridge] = await Promise.all([
  readFile(new URL("./index.html", import.meta.url), "utf8"),
  readFile(new URL("./scripts/native-bridge.js", import.meta.url), "utf8"),
  readFile(new URL("./native-bridge.js", import.meta.url), "utf8")
]);

test("trip alert permissions live only in Settings, not in driver or admin trip panels", () => {
  assert.equal((html.match(/id="settingsEnableTripNotifications"/g) || []).length, 1);
  assert.equal((html.match(/id="settingsEnableTripOverlay"/g) || []).length, 1);
  for (const obsoleteId of [
    "enableDriverNotifications",
    "enableDriverTripOverlay",
    "enableAdminNotifications",
    "enableAdminTripOverlay",
    "driverTripAlertSettings"
  ]) assert.equal(html.includes('id="' + obsoleteId + '"'), false, obsoleteId + " must be removed");
  assert.match(html, /id="tripAlertPermissionsCard"/);
  assert.equal((html.match(/id="tripAlertRegistrationStatus"/g) || []).length, 1);
});

test("staff entry starts the one-time Android notification and overlay permission flow", () => {
  assert.match(html, /if\(v==='chofer'\)void ensureDriverTripAlertPermissions\(\)/);
  assert.match(html, /requestTripNotificationPermission\(\)/);
  assert.match(html, /requestTripOverlayPermission\(\)/);
  const automaticFlow = html.match(/async function ensureDriverTripAlertPermissions\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(automaticFlow, /openTripNotificationSettings\(\)/);
  assert.match(nativeBridge, /LocalNotifications\.requestPermissions\(\)/);
  assert.match(nativeBridge, /export async function requestTripNotificationPermission/);
});

test("location permissions are feature-triggered, never requested during application startup", () => {
  assert.doesNotMatch(html, /requestStartupPermissions/);
  assert.doesNotMatch(nativeBridge, /export async function requestStartupPermissions/);
  assert.doesNotMatch(webBridge, /export async function requestStartupPermissions/);
  assert.match(html, /requestLocationPermission\(\)/);
  assert.match(html, /requestPreciseLocationPermission\(\)/);
});

test("browser bridge keeps every imported trip-alert API available without native behavior", () => {
  for (const name of [
    "requestTripNotificationPermission",
    "getTripAlertToken",
    "canDrawTripOverlay",
    "requestTripOverlayPermission",
    "canPostTripNotifications",
    "openTripNotificationSettings",
    "getPendingTripAction",
    "clearPendingTripAction",
    "stopTripAlert"
  ]) assert.match(webBridge, new RegExp("export async function " + name + "\\("), name);
});


test("native trip overlay exposes accept, view and reject as separate actions", async () => {
  const service = await readFile(new URL("./android-native/src/main/java/DanteTripAlertService.java", import.meta.url), "utf8");
  assert.match(service, /dispatchAction\("accept"\)/);
  assert.match(service, /dispatchAction\("view"\)/);
  assert.match(service, /dispatchAction\("reject"\)/);
  assert.match(service, /addAction\(0, "Ver viaje"/);
});

test("pending native actions are processed after the app becomes visible and are cleared only after handling", () => {
  assert.match(html, /document\.addEventListener\('visibilitychange',processNativeTripActionWhenVisible\)/);
  assert.match(html, /\['accept','view','reject'\]/);
  assert.match(html, /if\(sessionIsCurrent\(\)&&processed\)await clearPendingTripAction\(\)/);
});

test("Personal keeps pending requests map-free and opens the complete trip in Inicio", () => {
  const preview = html.match(/function renderDriverTripPreview\(trip,id\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const inbox = html.match(/function listenDriverInbox\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  const personalCard = inbox.slice(inbox.indexOf("if(kind==='driver')"), inbox.indexOf("}else{"));
  const activeCard = html.match(/function renderDriverActiveTrip\(trip,id\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(preview, /showDriverTripOnHome\(trip,id\)/);
  assert.doesNotMatch(preview, /driverTripMap|data-preview-accept|data-preview-reject/);
  assert.match(personalCard, /data-view-driver-trip/);
  assert.match(personalCard, /data-open-driver-trip-chat/);
  assert.match(personalCard, /data-reject-trip/);
  assert.doesNotMatch(personalCard, /data-accept-trip|driverTripMap/);
  assert.doesNotMatch(activeCard, /driverTripMap|renderDriverTripMap/);
  assert.match(html, /async function ensureDriverHomePendingRoute/);
  assert.match(html, /getDrivingRoute\(points(?:,\{steps:true\})?\)/);
  assert.match(html, /data-accept-trip/);
});


test("native floating trip alert strips postal and administrative address details", async () => {
  const service = await readFile(new URL("./android-native/src/main/java/DanteTripAlertService.java", import.meta.url), "utf8");
  assert.match(service, /origin = cleanAddress\(safe\(intent\.getStringExtra\("origin"\), 180\)\)/);
  assert.match(service, /destination = cleanAddress\(safe\(intent\.getStringExtra\("destination"\), 180\)\)/);
  assert.match(service, /private static String cleanAddress\(String value\)/);
  assert.match(service, /Ubicación sin referencia/);
  assert.match(service, /result\.append\(", "\)\.append\(part\)/);
  assert.match(service, /latitude\|longitude/);
});


test("native trip alerts can display optional road distances supplied by FCM", async () => {
  const service = await readFile(new URL("./android-native/src/main/java/DanteTripAlertService.java", import.meta.url), "utf8");
  assert.match(service, /originDistance = safe\(intent\.getStringExtra\("originDistance"\), 24\)/);
  assert.match(service, /destinationDistance = safe\(intent\.getStringExtra\("destinationDistance"\), 24\)/);
  assert.match(service, /distanceSuffix\(originDistance\)/);
  assert.match(service, /distanceSuffix\(destinationDistance\)/);
  assert.match(service, /String\.format\(java\.util\.Locale\.US, "%.1f km", meters \/ 1000\.0\)/);
  assert.match(service, /return " \(" \+ formatted \+ "\)"/);
  assert.doesNotMatch(service, /meters < 1000/);
  assert.match(service, /safe\(data\.get\("originDistance"\), 24\)/);
});


test("driver request cards show both road distances in kilometres", async () => {
  const homeState = await readFile(new URL("./driver-home-state.mjs", import.meta.url), "utf8");
  assert.match(homeState, /export function formatDriverCardDistance\(meters\)/);
  assert.match(html, /formatDriverCardDistance\(routeDistances\.pickupMeters\)/);
  assert.match(html, /formatDriverCardDistance\(routeDistances\.destinationMeters\)/);
  assert.match(html, /formatDriverCardDistance\(distances\.pickupMeters\)/);
  assert.match(html, /formatDriverCardDistance\(distances\.destinationMeters\)/);
});

test("driver request cards use structured places and separate road-leg distances", async () => {
  const [geocoding, homeState, html] = await Promise.all([
    readFile(new URL("./js/dante-geocoding.js", import.meta.url), "utf8"),
    readFile(new URL("./driver-home-state.mjs", import.meta.url), "utf8"),
    readFile(new URL("./index.html", import.meta.url), "utf8")
  ]);
  assert.match(geocoding, /placeName:String\(properties\.name/);
  assert.match(geocoding, /async function reverseDetails\(point\)/);
  assert.match(homeState, /export function formatDriverTripPlace\(point = \{\}\)/);
  assert.match(homeState, /export function getDriverRequestRouteDistances\(route\)/);
  assert.match(html, /data-driver-distance-kind="pickup"/);
  assert.match(html, /data-driver-distance-kind="destination"/);
  assert.match(html, /function driverHomeRequestRoutePoints\(trip,location=latestDriverLocation\)/);
  assert.match(html, /\.\.\.stops,trip\.destination/);
  assert.match(html, /getDrivingRoute\(points,\{steps:true\}\)/);
});

test("passenger sends road distances from fresh driver GPS to the alert Worker", () => {
  assert.match(html, /async function calculateTripAlertRoadDistances\(carId,origin,destination\)/);
  assert.match(html, /driverLocations\/\'\+carId/);
  assert.match(html, /getDrivingRoute\(points,\{steps:true\}\)/);
  assert.match(html, /tripId,\.\.\.alertDistances/);
});

test("local GPS updates are not throttled by Firebase writes", () => {
  const callback=html.match(/const onPosition=async pos=>\{([\s\S]*?)\n  \};\n  const onWatchError/)?.[1]||"";
  const mapUpdate=callback.indexOf("updateDriverHomeLocation(loc)");
  const navigationUpdate=callback.indexOf("updateDriverHomeNavigationPosition(loc)");
  const writeThrottle=callback.indexOf("const writeInterval=activeNavigation?2000:4000");
  assert.ok(mapUpdate>=0&&navigationUpdate>mapUpdate&&writeThrottle>navigationUpdate);
}); 

test("active navigation requires fresh GPS and preserves progress across fixes", () => {
  assert.match(html,/gpsAge>=15000/);
  assert.match(html,/previousProgress:driverHomeNavigation\.lastProgress/);
  assert.match(html,/driverHomeNavigation\.lastProgress=progress\.progress/);
  assert.match(html,/La ubicación cambió durante el cálculo/);
});

test("Mapbox preview animates all route legs and active navigation follows GPS progress", async () => {
  const [map, html] = await Promise.all([
    readFile(new URL("./js/dante-map.js", import.meta.url), "utf8"),
    readFile(new URL("./index.html", import.meta.url), "utf8")
  ]);
  assert.match(map, /addRoutePreview\(id, legs, options = \{\}\)/);
  assert.match(map, /const validLegs = \(legs \|\| \[\]\)\.filter\(leg => leg\?\.geometry && geoCoordinates\(leg\.geometry\)\.length > 1\)/);
  assert.match(map, /palette\[currentLeg\] \|\| palette\[1\]/);
  assert.match(map, /const colors = palette\[index\] \|\| palette\[1\]/);
  assert.match(map, /buildMovingGradient\(progress,colors\.base,colors\.highlight\)/);
  assert.doesNotMatch(map, /arrowPath\?\.setAttribute\('fill'/);
  assert.match(map, /width="42" height="42"/);
  assert.match(map, /lineMetrics:true/);
  assert.match(map, /points\.length > 2 && legLines\.length === 1/);
  assert.match(map, /buildMovingGradient/);
  assert.match(map, /setRouteProgress\(id,progress\)/);
  assert.match(map, /fill-rule="evenodd"/);
  assert.match(html, /addRoutePreview\('driver-home-pending-route',previewLegs/);
  assert.match(html, /setRouteProgress\?\.\('driver-home-navigation-route',progress\.progress\)/);
  assert.match(html, /addTripEndpointMarker\(markerId,\{lat,lon\},'pickup','Inicio'\)/);
  assert.match(html, /'destination','Final'\)/);
  const navigation = html.match(/function updateDriverHomeNavigationPosition\(loc,skipCamera=false\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(navigation, /Rutas:|© Geoapify|© Mapbox/);
  const accept = html.match(/async function handleDriverTripDecision\(id,decision\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(accept, /removeRoute\('driver-home-pending-route'\)/);
});


test("preview reconstructs a missing destination leg from the complete route geometry", async () => {
  const source = await readFile(new URL("./js/dante-map.js", import.meta.url), "utf8");
  const sandbox = { window: {}, console, URLSearchParams, fetch };
  runInNewContext(source, sandbox);
  const points = [{lat:0,lon:0},{lat:0,lon:0.01},{lat:0.01,lon:0.02}];
  const route = {
    geometry: {type:"LineString",coordinates:[[0,0],[0.005,0],[0.01,0],[0.015,0.005],[0.02,0.01]]},
    legs: [{geometry:{type:"LineString",coordinates:[[0,0],[0.005,0],[0.01,0]]}}, {geometry:null}]
  };
  const normalized = sandbox.window.DanteMap.normalizeRouteLegs(route,points);
  assert.equal(normalized.legs.length,2);
  assert.ok(normalized.legs[0].geometry.coordinates.length>=2);
  assert.ok(normalized.legs[1].geometry.coordinates.length>=2);
  assert.deepEqual(Array.from(normalized.legs[1].geometry.coordinates[0]),[0.01,0]);
  assert.deepEqual(Array.from(normalized.legs[1].geometry.coordinates.at(-1)),[0.02,0.01]);
});

test("preview splits a complete route into ordered legs and replaces provider legs with mismatched endpoints", async () => {
  const source = await readFile(new URL("./js/dante-map.js", import.meta.url), "utf8");
  const sandbox = { window: {}, console, URLSearchParams, fetch };
  runInNewContext(source, sandbox);
  const points=[{lat:0,lon:0},{lat:0,lon:0.01},{lat:0.01,lon:0.02}];
  const complete={type:"LineString",coordinates:[[0,0],[0.005,0],[0.01,0],[0.015,0.005],[0.02,0.01]]};
  const route={geometry:complete,legs:[
    {geometry:{type:"LineString",coordinates:[[0,0],[0.005,0],[0.01,0]]}},
    {geometry:{type:"LineString",coordinates:[[0,0],[0.005,0],[0.01,0]]}}
  ]};
  const normalized=sandbox.window.DanteMap.normalizeRouteLegs(route,points);
  assert.equal(normalized.legs.length,2);
  assert.deepEqual(Array.from(normalized.legs[1].geometry.coordinates[0]),[0.01,0]);
  assert.deepEqual(Array.from(normalized.legs[1].geometry.coordinates.at(-1)),[0.02,0.01]);
});

test("driver GPS uses a bounded high-accuracy watch with native fallback and precise Android location", () => {
  assert.match(nativeBridge,/interval:\s*options\.interval\s*\?\?\s*2000/);
  assert.match(nativeBridge,/minimumUpdateInterval:\s*options\.minimumUpdateInterval\s*\?\?\s*1500/);
  assert.match(nativeBridge,/maximumAge:\s*options\.maximumAge\s*\?\?\s*5000/);
  assert.match(nativeBridge,/current\.location === "granted"/);
  const precisePermission=nativeBridge.match(/export async function requestPreciseLocationPermission\(\)\s*\{[\s\S]*?\n\}/)?.[0]||"";
  assert.match(precisePermission,/Geolocation\.checkPermissions\(\)/);
  assert.match(precisePermission,/requestPermissions\(\{ permissions: \["location"\] \}\)/);
  assert.match(precisePermission,/return requested\.location === "granted"/);
  assert.doesNotMatch(precisePermission,/coarseLocation/);
  assert.match(html,/requestPreciseLocationPermission\(\)/);
  assert.match(html,/maximumAge:5000,timeout:20000,interval:2500,minimumUpdateInterval:1500,enableLocationFallback:true/);
  assert.match(html,/activeNavigation\?2000:4000/);
});

test("stage-one preview refreshes with smaller GPS movement and keeps its micropause", () => {
  assert.match(html,/driverHomeDistanceMeters\(driverHomePendingRouteLastLocation,latestDriverLocation\)>25/);
  assert.match(html,/now-driverHomePendingRouteLastAttemptAt<10000/);
  assert.match(html,/durationMs:2600,pauseMs:240/);
});

test("active navigation refreshes on meaningful route age/distance or off-route deviation", () => {
  assert.match(html,/cooldownMs:15000/);
  assert.match(html,/thresholdMeters:Math\.max\(35,accuracyMeters\*1\.5\)/);
  assert.match(html,/distanceFromRouteStart>=220&&routeAgeMs>=60000/);
  assert.match(html,/rerouteCount\|\|0\)<20/);
  assert.match(html,/const previousRoute=same\?driverHomeNavigation\.route:null/);
});

test("active navigation gradient has a feathered transition and a soft glow", async () => {
  const source = await readFile(new URL("./js/dante-map.js", import.meta.url), "utf8");
  const sandbox = {window:{DANTE_MAPBOX_TOKEN:"pk.test"},mapboxgl:{supported:()=>true},console,URLSearchParams,fetch};
  runInNewContext(source,sandbox);
  const expression=Array.from(sandbox.window.DanteMap.buildProgressGradient(.5));
  const stops=expression.filter(value=>typeof value==="number");
  assert.ok(stops.some(value=>Math.abs(value-.482)<.002));
  assert.ok(stops.some(value=>Math.abs(value-.518)<.002));
  assert.match(source,/'line-blur':style\.glowBlur\|\|4/);
  assert.match(source,/progressValue=from\+\(target-from\)\*eased/);
});

test("preview arrow and moving gradient use equal speed across legs of different lengths", async () => {
  const source = await readFile(new URL("./js/dante-map.js", import.meta.url), "utf8");
  const sandbox = { window: {}, console, URLSearchParams, fetch };
  runInNewContext(source, sandbox);
  const shortLeg={type:"LineString",coordinates:[[0,0],[0.01,0]]};
  const longLeg={type:"LineString",coordinates:[[0,0],[0.02,0]]};
  const shortLength=sandbox.window.DanteMap.routeGeometryLengthMeters(shortLeg);
  const longLength=sandbox.window.DanteMap.routeGeometryLengthMeters(longLeg);
  const shortDuration=shortLength/(shortLength/3400);
  const longDuration=longLength/(shortLength/3400);
  assert.ok(Math.abs(shortLength/shortDuration-longLength/longDuration)<1e-9);
  assert.ok(longDuration>shortDuration*1.9);
});

test("preview gradient highlight is centered on arrow progress and arrow remains green with a transparent window", async () => {
  const source = await readFile(new URL("./js/dante-map.js", import.meta.url), "utf8");
  const sandbox = { window: {}, console, URLSearchParams, fetch };
  runInNewContext(source, sandbox);
  const gradient = Array.from(sandbox.window.DanteMap.buildMovingGradient(0.5,"#14532d","#4ade80"));
  assert.ok(gradient.includes("#4ade80"));
  assert.ok(gradient.includes("#14532d"));
  const stopPositions=gradient.filter(value=>typeof value==="number");
  assert.ok(stopPositions.length>=5);
  assert.ok(stopPositions.every((value,index)=>index===0||value>stopPositions[index-1]));
  assert.match(source,/fill="#198754" fill-rule="evenodd"/);
  assert.ok(source.includes('stroke="#fff" stroke-width="2.4"'));
  assert.equal(source.includes("arrowPath?.setAttribute('fill'"),false);
  assert.ok(source.includes("routeLayers[currentLeg]?.setGradient("));
});


test("Mapbox preview creates every leg in one style-ready pass and animates the gradient layers", async () => {
  const source = await readFile(new URL("./js/dante-map.js", import.meta.url), "utf8");
  const state = {sources:new Map(),layers:new Map(),paintUpdates:[],listeners:new Map()};
  class FakeMap {
    constructor(){this.styleLoaded=true;}
    addControl(){}
    isStyleLoaded(){return this.styleLoaded;}
    addSource(id,source){state.sources.set(id,source);this.styleLoaded=false;}
    addLayer(layer){
      state.layers.set(layer.id,{...layer,paint:{...layer.paint}});
      this.styleLoaded=false;
    }
    getSource(id){return state.sources.get(id);}
    getLayer(id){return state.layers.get(id);}
    setPaintProperty(id,name,value){
      const layer=state.layers.get(id);
      if(!layer)throw new Error("missing layer "+id);
      layer.paint[name]=value;
      state.paintUpdates.push({id,name,value});
    }
    removeLayer(id){state.layers.delete(id);}
    removeSource(id){state.sources.delete(id);}
    on(name,callback){state.listeners.set(name,callback);}
    off(name,callback){if(state.listeners.get(name)===callback)state.listeners.delete(name);}
    once(name,callback){const list=state.listeners.get(name)||[];state.listeners.set(name,[...list,callback]);}
    getBearing(){return 0;}
  }
  class FakeMarker {
    setLngLat(value){this.position=value;return this;}
    addTo(){return this;}
    setRotation(value){this.rotation=value;return this;}
    remove(){}
  }
  const mapboxgl={supported:()=>true,Map:FakeMap,Marker:FakeMarker,NavigationControl:class{},AttributionControl:class{constructor(options){this.options=options;}}};
  const windowRef={
    DANTE_MAPBOX_TOKEN:"pk.test-public-token",
    mapboxgl,
    matchMedia:()=>({matches:false}),
    addEventListener(){},
    removeEventListener(){},
    visualViewport:{addEventListener(){},removeEventListener(){}}
  };
  const frames=[];
  const sandbox={
    window:windowRef,mapboxgl,console,URLSearchParams,fetch,
    document:{createElement:()=>({style:{}})},
    requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},
    cancelAnimationFrame(){}
  };
  runInNewContext(source,sandbox);
  const map=sandbox.window.DanteMap.create({},[-32.07,-64.53],13,"");
  const legs=[
    {geometry:{type:"LineString",coordinates:[[-64.53,-32.07],[-64.52,-32.07],[-64.51,-32.07]]}},
    {geometry:{type:"LineString",coordinates:[[-64.51,-32.07],[-64.50,-32.06],[-64.49,-32.05]]}}
  ];
  map.addRoutePreview("preview-test",legs,{durationMs:3400,weight:6,opacity:.94});
  assert.equal(state.sources.size,2,"both route legs must have independent GeoJSON sources");
  assert.equal(state.layers.size,6,"each leg must have a visible halo, base line and gradient line");
  assert.ok([...state.layers.keys()].some(id=>id.includes("leg-0-gradient")));
  assert.ok([...state.layers.keys()].some(id=>id.includes("leg-1-gradient")));
  let timestamp=1000;
  for(let index=0;index<450;index++){
    const frame=frames.shift();
    assert.equal(typeof frame,"function","the animation must schedule its next frame");
    frame(timestamp);
    timestamp+=40;
  }
  assert.ok(state.paintUpdates.some(update=>update.id.includes("leg-0-gradient")&&update.name==="line-gradient"));
  assert.ok(state.paintUpdates.some(update=>update.id.includes("leg-1-gradient")&&update.name==="line-gradient"));
});

test("Mapbox preview keeps route legs visible and animates a color fallback if line-gradient is rejected", async () => {
  const source = await readFile(new URL("./js/dante-map.js", import.meta.url), "utf8");
  const state = {sources:new Map(),layers:new Map(),paintUpdates:[]};
  class FakeMap {
    constructor(){this.styleLoaded=true;}
    addControl(){}
    isStyleLoaded(){return this.styleLoaded;}
    addSource(id,source){state.sources.set(id,source);this.styleLoaded=false;}
    addLayer(layer){
      if(layer.paint?.["line-gradient"])throw new Error("line-gradient unavailable");
      state.layers.set(layer.id,{...layer,paint:{...layer.paint}});
      this.styleLoaded=false;
    }
    getSource(id){return state.sources.get(id);}
    getLayer(id){return state.layers.get(id);}
    setPaintProperty(id,name,value){
      const layer=state.layers.get(id);
      if(!layer)throw new Error("missing layer "+id);
      layer.paint[name]=value;
      state.paintUpdates.push({id,name,value});
    }
    removeLayer(id){state.layers.delete(id);}
    removeSource(id){state.sources.delete(id);}
    on(){}
    off(){}
    once(){}
    getBearing(){return 0;}
  }
  class FakeMarker {
    setLngLat(value){this.position=value;return this;}
    addTo(){return this;}
    setRotation(value){this.rotation=value;return this;}
    remove(){}
  }
  const mapboxgl={supported:()=>true,Map:FakeMap,Marker:FakeMarker,NavigationControl:class{},AttributionControl:class{constructor(options){this.options=options;}}};
  const sandbox={
    window:{DANTE_MAPBOX_TOKEN:"pk.test-public-token",mapboxgl,matchMedia:()=>({matches:false}),addEventListener(){},removeEventListener(){},visualViewport:{addEventListener(){},removeEventListener(){}}},
    mapboxgl,console,URLSearchParams,fetch,
    document:{createElement:()=>({style:{}})},
    requestAnimationFrame:callback=>{state.nextFrame=callback;return 1;},
    cancelAnimationFrame(){}
  };
  runInNewContext(source,sandbox);
  const map=sandbox.window.DanteMap.create({},[-32.07,-64.53],13,"");
  map.addRoutePreview("preview-fallback",[
    {geometry:{type:"LineString",coordinates:[[-64.53,-32.07],[-64.52,-32.07]]}},
    {geometry:{type:"LineString",coordinates:[[-64.52,-32.07],[-64.51,-32.06]]}}
  ],{durationMs:3400,weight:6});
  assert.equal(state.layers.size,2,"base lines must survive a rejected gradient layer");
  state.nextFrame(1000);
  state.nextFrame(1400);
  assert.ok(state.paintUpdates.some(update=>update.name==="line-color"),"fallback line color must animate");
});


test("Geoapify MultiLineString response preserves the two legs from driver to pickup and destination", async () => {
  const source = await readFile(new URL("./js/dante-map.js", import.meta.url), "utf8");
  const legA=[[-64.53,-32.07],[-64.52,-32.07],[-64.51,-32.07]];
  const legB=[[-64.51,-32.07],[-64.50,-32.06],[-64.49,-32.05]];
  const response={features:[{
    type:"Feature",
    geometry:{type:"MultiLineString",coordinates:[legA,legB]},
    properties:{distance:2500,time:300,legs:[{distance:1100,time:130,steps:[]},{distance:1400,time:170,steps:[]}]}
  }]};
  const sandbox={
    window:{DANTE_GEOAPIFY_KEY:"test-geoapify-key"},
    console,URLSearchParams,
    fetch:async()=>({ok:true,json:async()=>response})
  };
  runInNewContext(source,sandbox);
  const points=[
    {lat:-32.07,lon:-64.53},
    {lat:-32.07,lon:-64.51},
    {lat:-32.05,lon:-64.49}
  ];
  const route=await sandbox.window.DanteMap.getDrivingRoute(points,{steps:true});
  assert.equal(route.provider,"Geoapify");
  assert.equal(route.legs.length,2);
  assert.deepEqual(Array.from(route.legs[0].geometry.coordinates[0]),legA[0]);
  assert.deepEqual(Array.from(route.legs[0].geometry.coordinates.at(-1)),legA.at(-1));
  assert.deepEqual(Array.from(route.legs[1].geometry.coordinates[0]),legB[0]);
  assert.deepEqual(Array.from(route.legs[1].geometry.coordinates.at(-1)),legB.at(-1));
});
