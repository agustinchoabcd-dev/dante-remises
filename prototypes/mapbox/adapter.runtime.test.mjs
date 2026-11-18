import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../js/dante-map.js", import.meta.url), "utf8");

function createHarness({token="pk.test-public-token", supported=true, fetchImpl}={}) {
  const state = {maps:[], markers:[], sources:new Map(), layers:new Map(), fetchCalls:[]};
  class FakeMap {
    constructor(options) { this.options=options; this.handlers={}; this.loaded=true; this.removed=false; state.maps.push(this); }
    addControl(control, position) { this.control={control,position}; }
    on(name, callback) { this.handlers[name]=callback; }
    once(name, callback) { this.handlers[name]=callback; }
    isStyleLoaded() { return this.loaded; }
    addSource(id, source) { state.sources.set(id,source); }
    getSource(id) { return state.sources.get(id); }
    removeSource(id) { state.sources.delete(id); }
    addLayer(layer) { state.layers.set(layer.id,layer); }
    getLayer(id) { return state.layers.get(id); }
    removeLayer(id) { state.layers.delete(id); }
    easeTo(options) { this.lastEase=options; }
    fitBounds(bounds, options) { this.lastBounds={bounds,options}; }
    resize() { this.resized=true; }
    remove() { this.removed=true; }
  }
  class FakeMarker {
    constructor(options) { this.options=options; state.markers.push(this); }
    setLngLat(point) { this.point=point; return this; }
    setPopup(popup) { this.popup=popup; return this; }
    addTo(map) { this.map=map; this.added=true; return this; }
    remove() { this.removed=true; }
  }
  class FakePopup {
    constructor(options) { this.options=options; }
    setText(text) { this.text=text; return this; }
  }
  class FakeBounds {
    constructor() { this.points=[]; }
    extend(point) { this.points.push(point); return this; }
  }
  const mapboxgl = {
    supported:()=>supported,
    accessToken:"",
    Map:FakeMap,
    Marker:FakeMarker,
    Popup:FakePopup,
    LngLatBounds:FakeBounds,
    NavigationControl:class {constructor(options){this.options=options;}}
  };
  const fakeFetch = fetchImpl || (async url => {
    state.fetchCalls.push(String(url));
    return {ok:true,json:async()=>({code:"Ok",routes:[{distance:1200,duration:300,geometry:{type:"LineString",coordinates:[[-64.5,-32.1],[-64.49,-32.09]]}}]})};
  });
  const context = {
    window:{DANTE_MAPBOX_TOKEN:token,mapboxgl},
    mapboxgl,
    document:{createElement:()=>({style:{}})},
    fetch:fakeFetch,
    console:{warn(){},error(){}},
    setTimeout,
    requestAnimationFrame:callback=>callback(),
    encodeURIComponent,
    Number,
    String,
    Map,
    Math,
    Object,
    Array,
    Error
  };
  vm.runInNewContext(source,context,{filename:"dante-map.js"});
  return {api:context.window.DanteMap,state,mapboxgl};
}

test("Mapbox renderer initializes with longitude/latitude order and navigation controls",()=>{
  const {api,state,mapboxgl}=createHarness();
  const map=api.create({},[-32.1,-64.5],14,"unused");
  assert.equal(map.backend,"mapbox");
  assert.equal(state.maps.length,1);
  assert.deepEqual(Array.from(state.maps[0].options.center),[-64.5,-32.1]);
  assert.equal(mapboxgl.accessToken,"pk.test-public-token");
  assert.equal(state.maps[0].control.position,"top-right");
});

test("Mapbox markers can be updated and removed through the adapter handle",()=>{
  const {api,state}=createHarness();
  const map=api.create({},[-32.1,-64.5],14,"unused");
  const marker=map.addMarker("pickup",{lat:-32.1,lon:-64.5},"Origen");
  assert.deepEqual(Array.from(state.markers[0].point),[-64.5,-32.1]);
  assert.equal(state.markers[0].popup.text,"Origen");
  marker.setLatLng({lat:-32.2,lon:-64.6});
  assert.deepEqual(Array.from(state.markers[0].point),[-64.6,-32.2]);
  map.removeLayer(marker);
  assert.equal(state.markers[0].removed,true);
});

test("Mapbox route layers are added, fitted and removed without leaving map sources",()=>{
  const {api,state}=createHarness();
  const map=api.create({},[-32.1,-64.5],14,"unused");
  const geometry={type:"LineString",coordinates:[[-64.5,-32.1],[-64.49,-32.09]]};
  map.addRoute("trip",geometry,{color:"#123456",weight:5});
  assert.equal(state.sources.has("dante-route-trip"),true);
  assert.equal(state.layers.get("dante-route-trip-line").paint["line-color"],"#123456");
  map.fitGeometry(geometry);
  assert.equal(state.maps[0].lastBounds.bounds.points.length,2);
  map.removeRoute("trip");
  assert.equal(state.sources.has("dante-route-trip"),false);
  assert.equal(state.layers.has("dante-route-trip-line"),false);
});

test("Mapbox Directions returns the first route and sends the requested coordinates",async()=>{
  const {api,state}=createHarness();
  const route=await api.getDrivingRoute([{lat:-32.1,lon:-64.5},{lat:-32.2,lon:-64.6}]);
  assert.equal(route.provider,"Mapbox");
  assert.equal(route.distance,1200);
  assert.match(state.fetchCalls[0],/directions\/v5\/mapbox\/driving\/-64\.5,-32\.1;-64\.6,-32\.2/);
});

test("Mapbox Directions refuses to silently use another provider when token is missing",async()=>{
  let calls=0;
  const {api}=createHarness({token:"",fetchImpl:async()=>{calls++;throw new Error("unexpected fetch");}});
  await assert.rejects(api.getDrivingRoute([{lat:-32.1,lon:-64.5},{lat:-32.2,lon:-64.6}]),/MAPBOX_TOKEN_NOT_CONFIGURED/);
  assert.equal(calls,0);
});

test("Mapbox map instance disposes its markers, routes and native map",()=>{
  const {api,state}=createHarness();
  const map=api.create({},[-32.1,-64.5],14,"unused");
  map.addMarker("a",{lat:-32.1,lon:-64.5});
  map.addRoute("b",{type:"LineString",coordinates:[[-64.5,-32.1],[-64.49,-32.09]]});
  map.remove();
  assert.equal(state.markers[0].removed,true);
  assert.equal(state.maps[0].removed,true);
});
