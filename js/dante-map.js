(() => {
  'use strict';

  const MAPBOX_TOKEN = window.DANTE_MAPBOX_TOKEN || '';
  const GEOAPIFY_KEY = window.DANTE_GEOAPIFY_KEY || '';
  const DEFAULT_STYLE = 'mapbox://styles/mapbox/streets-v12';

  function validPoint(point) {
    return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon));
  }

  function geoCoordinates(geometry, output = []) {
    if (!geometry) return output;
    if (geometry.type === 'Feature') return geoCoordinates(geometry.geometry, output);
    if (geometry.type === 'FeatureCollection') {
      (geometry.features || []).forEach(feature => geoCoordinates(feature, output));
      return output;
    }
    const visit = value => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        output.push([Number(value[0]), Number(value[1])]);
      } else value.forEach(visit);
    };
    visit(geometry.coordinates);
    return output;
  }


  function coordinateDistanceMeters(a, b) {
    const radians = value => value * Math.PI / 180;
    const lat1 = radians(Number(a[1])), lat2 = radians(Number(b[1]));
    const dLat = lat2 - lat1, dLon = radians(Number(b[0]) - Number(a[0]));
    const raw = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const h = Math.max(0,Math.min(1,raw));
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function splitRouteGeometryByWaypoints(geometry, waypoints) {
    const coordinates = geoCoordinates(geometry);
    if (!Array.isArray(waypoints) || waypoints.length < 2 || coordinates.length < waypoints.length) return [];
    const boundaries = [0];
    let startIndex = 0;
    for (let waypointIndex = 1; waypointIndex < waypoints.length - 1; waypointIndex++) {
      const remainingLegs = waypoints.length - 1 - waypointIndex;
      const minIndex = startIndex + 1;
      const maxIndex = coordinates.length - 1 - remainingLegs;
      if (minIndex > maxIndex) return [];
      const waypoint = [Number(waypoints[waypointIndex].lon), Number(waypoints[waypointIndex].lat)];
      let nearestIndex = minIndex, nearestDistance = Infinity;
      for (let index = minIndex; index <= maxIndex; index++) {
        const distance = coordinateDistanceMeters(coordinates[index], waypoint);
        if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
      }
      boundaries.push(nearestIndex);
      startIndex = nearestIndex;
    }
    boundaries.push(coordinates.length - 1);
    const legs = [];
    for (let index = 0; index < boundaries.length - 1; index++) {
      const line = coordinates.slice(boundaries[index], boundaries[index + 1] + 1);
      if (line.length < 2) return [];
      legs.push({type:'LineString',coordinates:line});
    }
    return legs;
  }

  function normalizeRouteLegs(route, waypoints) {
    const expected = Math.max(0,(waypoints || []).length - 1);
    if (!expected) return route;
    const fallback = splitRouteGeometryByWaypoints(route?.geometry,waypoints);
    const source = Array.isArray(route?.legs) ? route.legs : [];
    const legs = Array.from({length:expected},(_,index) => {
      const leg = source[index] || {};
      const coordinates = geoCoordinates(leg.geometry);
      const start = waypoints[index], end = waypoints[index + 1];
      const endpointsMatch = coordinates.length > 1 && start && end &&
        coordinateDistanceMeters(coordinates[0],[Number(start.lon),Number(start.lat)]) <= 300 &&
        coordinateDistanceMeters(coordinates[coordinates.length - 1],[Number(end.lon),Number(end.lat)]) <= 300;
      // Provider legs are not trusted merely because they contain coordinates:
      // a malformed/duplicated first leg must not suppress reconstruction of B→C.
      return {...leg,geometry:endpointsMatch?leg.geometry:(fallback[index] || null)};
    });
    return {...route,legs};
  }

  function routePositionAt(geometry, progress) {
    const coordinates = geometry?.type === 'MultiLineString'
      ? geometry.coordinates.flat()
      : geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const lengths = [];
    let total = 0;
    for (let index = 0; index < coordinates.length - 1; index++) {
      const length = coordinateDistanceMeters(coordinates[index], coordinates[index + 1]);
      lengths.push(length);
      total += length;
    }
    if (!total) return null;
    let remaining = total * Math.max(0, Math.min(1, Number(progress) || 0));
    for (let index = 0; index < lengths.length; index++) {
      const length = lengths[index];
      if (remaining <= length || index === lengths.length - 1) {
        const fraction = length ? Math.max(0, Math.min(1, remaining / length)) : 0;
        const a = coordinates[index], b = coordinates[index + 1];
        const lat1 = Number(a[1]) * Math.PI / 180, lat2 = Number(b[1]) * Math.PI / 180;
        const dLon = (Number(b[0]) - Number(a[0])) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        return {
          coordinates: [
            Number(a[0]) + (Number(b[0]) - Number(a[0])) * fraction,
            Number(a[1]) + (Number(b[1]) - Number(a[1])) * fraction
          ],
          bearing: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
        };
      }
      remaining -= length;
    }
    return null;
  }

  function routeGeometryLengthMeters(geometry) {
    const coordinates = geoCoordinates(geometry);
    let total = 0;
    for (let index=1; index<coordinates.length; index++) {
      total += coordinateDistanceMeters(coordinates[index-1],coordinates[index]);
    }
    return total;
  }

  function buildProgressGradient(progress, style = {}) {
    const value = Math.max(0, Math.min(1, Number(progress) || 0));
    const completed = style.completedColor || '#14532d';
    const pendingStart = style.pendingStartColor || '#166534';
    const pendingEnd = style.pendingEndColor || '#4ade80';
    if (value <= 0) return ['interpolate', ['linear'], ['line-progress'], 0, pendingStart, 1, pendingEnd];
    if (value >= 1) return ['interpolate', ['linear'], ['line-progress'], 0, completed, 1, completed];
    const boundary = Math.max(0.001, Math.min(0.999, value));
    const feather = Math.min(0.018,boundary,1-boundary);
    const before = Math.max(0,boundary-feather);
    const after = Math.min(1,boundary+feather);
    const blend = interpolateHexColor(completed,pendingStart,.5);
    const expression = ['interpolate',['linear'],['line-progress'],0,completed,before,completed,boundary,blend,after,pendingStart];
    if(after<1)expression.push(1,pendingEnd);
    return expression;
  }

  function buildMovingGradient(progress, baseColor, highlightColor) {
    const value = Math.max(0,Math.min(1,Number(progress)||0));
    const outerWidth = 0.19, innerWidth = 0.075;
    const start = Math.max(0,value-outerWidth);
    const innerStart = Math.max(0,value-innerWidth);
    const innerEnd = Math.min(1,value+innerWidth);
    const end = Math.min(1,value+outerWidth);
    const blend = interpolateHexColor(baseColor,highlightColor,.62);
    const expression = ['interpolate',['linear'],['line-progress'],0,value<=innerWidth?highlightColor:baseColor];
    if (start > 0) expression.push(start,baseColor);
    if (innerStart > start) expression.push(innerStart,blend);
    if (value > innerStart) expression.push(value,highlightColor);
    if (innerEnd > value) expression.push(innerEnd,blend);
    if (end > innerEnd) expression.push(end,baseColor);
    if (end < 1) expression.push(1,baseColor);
    return expression;
  }

  function interpolateHexColor(fromColor,toColor,amount) {
    const parse = color => String(color).replace('#','').match(/.{2}/g)?.map(value=>parseInt(value,16)) || [0,0,0];
    const from=parse(fromColor),to=parse(toColor),t=Math.max(0,Math.min(1,Number(amount)||0));
    return '#'+from.map((value,index)=>Math.round(value+(to[index]-value)*t).toString(16).padStart(2,'0')).join('');
  }

  function movingGradientColorAt(progress,baseColor,highlightColor) {
    const value=Math.max(0,Math.min(1,Number(progress)||0));
    const start=Math.max(0.001,Math.min(0.72,value*0.72+0.001));
    const middle=Math.min(0.999,start+0.14),end=Math.min(1,start+0.28);
    if(value<=start)return baseColor;
    if(value<=middle)return interpolateHexColor(baseColor,highlightColor,(value-start)/Math.max(0.001,middle-start));
    if(value<=end)return interpolateHexColor(highlightColor,baseColor,(value-middle)/Math.max(0.001,end-middle));
    return baseColor;
  }

  class LeafletAdapter {
    constructor(container, center, zoom, locationIqKey) {
      if (!window.L) throw new Error('Leaflet no está disponible para el mapa alternativo.');
      this.backend = 'leaflet';
      this.map = L.map(container,{zoomControl:false}).setView([Number(center[0]), Number(center[1])], zoom);
      L.control.zoom({position:'topright'}).addTo(this.map);
      L.tileLayer('https://tiles.locationiq.com/v3/streets/r/{z}/{x}/{y}.png?key=' +
        encodeURIComponent(locationIqKey), {
          maxZoom: 20,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://locationiq.com">LocationIQ</a>'
        }).addTo(this.map);
      this.map.attributionControl?.addAttribution('<a href="https://www.geoapify.com/" target="_blank" rel="noopener">Powered by Geoapify</a>');
    }
    onClick(callback) {
      this.map.on('click', event => callback({lat: event.latlng.lat, lon: event.latlng.lng}));
    }
    onUserMove(callback) {
      const drag = event => callback(event);
      const zoom = event => { if(event?.originalEvent)callback(event); };
      const container=this.map.getContainer();
      const zoomControl=container.querySelector('.leaflet-control-zoom');
      const zoomClick=event=>{if(event.target?.closest?.('.leaflet-control-zoom a'))callback(event)};
      const wheel=event=>callback(event);
      const touch=event=>callback(event);
      this.map.on('dragstart',drag);
      this.map.on('zoomstart',zoom);
      zoomControl?.addEventListener('click',zoomClick);
      container.addEventListener('wheel',wheel,{passive:true});
      container.addEventListener('touchmove',touch,{passive:true});
      return () => {
        this.map?.off('dragstart',drag);this.map?.off('zoomstart',zoom);
        zoomControl?.removeEventListener('click',zoomClick);
        container.removeEventListener('wheel',wheel);container.removeEventListener('touchmove',touch);
      };
    }
    addHeadingMarker(id, point, heading = 0) {
      this.removeMarker(id);
      const element = document.createElement('div');
      element.className = 'dante-driver-heading';
      element.innerHTML = '<svg viewBox="0 0 34 34" width="42" height="42" aria-hidden="true"><path d="M17 2.5 29 30 17 23.2 5 30Z" fill="#18a86b" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/></svg>';
      Object.assign(element.style, {width:'42px',height:'42px',display:'grid',placeItems:'center',filter:'drop-shadow(0 2px 4px #001b0d99)',transform:'rotate('+(Number(heading)||0)+'deg)',transformOrigin:'center'});
      const marker = L.marker([Number(point.lat),Number(point.lon)], {icon:L.divIcon({html:element,className:'dante-driver-heading-icon',iconSize:[42,42],iconAnchor:[21,21]}),interactive:false,keyboard:false}).addTo(this.map);
      const handle = {
        setLatLng: next => marker.setLatLng([Number(next.lat),Number(next.lon)]),
        setHeading: value => { element.style.transform='rotate('+(Number(value)||0)+'deg)'; },
        remove: () => { this.map.removeLayer(marker); this.markers?.delete(id); }
      };
      this.markers ||= new Map();
      this.markers.set(id, handle);
      return handle;
    }
    addMarker(id, point, popup) {
      this.removeMarker(id);
      const marker = L.marker([Number(point.lat), Number(point.lon)]).addTo(this.map);
      if (popup) marker.bindPopup(popup);
      const handle = {
        setLatLng: next => marker.setLatLng([Number(next.lat), Number(next.lon)]),
        remove: () => { this.map.removeLayer(marker); this.markers?.delete(id); }
      };
      this.markers ||= new Map();
      this.markers.set(id, handle);
      return handle;
    }
    addCircleMarker(id, point, options = {}) {
      this.removeMarker(id);
      const marker = L.circleMarker([Number(point.lat), Number(point.lon)], {
        radius: options.radius || 9, color: options.color || '#fff',
        weight: options.weight || 3, fillColor: options.fillColor || '#176b3a',
        fillOpacity: options.fillOpacity ?? 1
      }).addTo(this.map);
      if (options.popup) marker.bindPopup(options.popup);
      const handle = {
        setLatLng: next => marker.setLatLng([Number(next.lat), Number(next.lon)]),
        remove: () => { this.map.removeLayer(marker); this.markers?.delete(id); }
      };
      this.markers ||= new Map();
      this.markers.set(id, handle);
      return handle;
    }
    removeMarker(id) { const marker = this.markers?.get(id); if (marker) marker.remove(); }
    addRoute(id, geometry, style = {}) {
      this.removeRoute(id);
      const layer = L.geoJSON({type:'Feature', geometry, properties:{}}, {
        style: {color:style.color || '#168447', weight:style.weight || 6, opacity:style.opacity ?? .85}
      }).addTo(this.map);
      const handle = {remove: () => this.map.removeLayer(layer), getBounds: () => layer.getBounds()};
      this.routes ||= new Map();
      this.routes.set(id, handle);
      return handle;
    }
    addRoutePreview(id, legs) {
      this.removeRoute(id);
      const colors = ['#eab308', '#166534'];
      const childIds = [];
      (legs || []).forEach((leg, index) => {
        if (!leg?.geometry || geoCoordinates(leg.geometry).length < 2) return;
        const childId = id + '-leg-' + index;
        this.addRoute(childId, leg.geometry, {color:colors[index] || '#168447',weight:6,opacity:.92});
        childIds.push(childId);
      });
      const handle = {remove:() => childIds.forEach(childId => this.removeRoute(childId))};
      this.routes.set(id, handle);
      return handle;
    }
    setRouteProgress() {}
    removeRoute(id) { const route = this.routes?.get(id); if (route) { route.remove(); this.routes.delete(id); } }
    centerOn(point, zoom = 16) {
      if(!validPoint(point))return false;
      this.map.stop();
      this.map.setView([Number(point.lat),Number(point.lon)],Math.max(3,Math.min(20,Number(zoom)||16)),{animate:false});
      return true;
    }
    addTripEndpointMarker(id, point, kind = 'pickup', popup = '') {
      this.removeMarker(id);
      const pickup = kind === 'pickup';
      const color = pickup ? '#ed9418' : '#dc3545';
      const svg = pickup
        ? '<svg viewBox="0 0 40 48" width="34" height="42" aria-hidden="true"><path d="M20 2C9.5 2 2 9.6 2 19.2 2 31 20 46 20 46s18-15 18-26.8C38 9.6 30.5 2 20 2Z" fill="'+color+'" stroke="#fff" stroke-width="2.4"/><circle cx="20" cy="16" r="5" fill="#fff"/><path d="M10.5 30c.8-6 4.2-9 9.5-9s8.7 3 9.5 9" fill="#fff"/></svg>'
        : '<svg viewBox="0 0 40 48" width="34" height="42" aria-hidden="true"><path d="M20 2C9.5 2 2 9.6 2 19.2 2 31 20 46 20 46s18-15 18-26.8C38 9.6 30.5 2 20 2Z" fill="'+color+'" stroke="#fff" stroke-width="2.4"/><circle cx="20" cy="19" r="6" fill="#fff"/></svg>';
      const marker = L.marker([Number(point.lat),Number(point.lon)],{icon:L.divIcon({html:svg,className:'dante-trip-endpoint-icon',iconSize:[34,42],iconAnchor:[17,40]}),keyboard:false});
      if(popup)marker.bindPopup(popup);
      marker.addTo(this.map);
      const handle={setLatLng:next=>marker.setLatLng([Number(next.lat),Number(next.lon)]),remove:()=>{this.map.removeLayer(marker);this.markers?.delete(id)}};
      this.markers ||= new Map();this.markers.set(id,handle);return handle;
    }
    fitPoints(points, padding = .15) {
      const valid = (points || []).filter(validPoint);
      if (valid.length === 1) this.map.setView([Number(valid[0].lat), Number(valid[0].lon)], 16);
      else if (valid.length > 1) {
        const bounds = L.latLngBounds(valid.map(p => [Number(p.lat), Number(p.lon)]));
        const options = padding && typeof padding === 'object'
          ? {paddingTopLeft:[Number(padding.left)||0,Number(padding.top)||0],paddingBottomRight:[Number(padding.right)||0,Number(padding.bottom)||0]}
          : {padding:Math.max(.05,Number(padding)||.15)};
        this.map.fitBounds(bounds, options);
      }
    }
    followLocation(point) {
      if (!validPoint(point)) return;
      this.map.setView([Number(point.lat), Number(point.lon)], Math.max(this.map.getZoom(), 16), {animate:true, duration:0.45});
    }
    fitGeometry(geometry, padding = .15, includePoints = []) {
      const layer = L.geoJSON({type:'Feature', geometry, properties:{}});
      const bounds = layer.getBounds();
      if (!bounds.isValid()) return;
      (includePoints||[]).filter(validPoint).forEach(point=>bounds.extend([Number(point.lat),Number(point.lon)]));
      const options = padding && typeof padding === 'object'
        ? {paddingTopLeft:[Number(padding.left)||0,Number(padding.top)||0],paddingBottomRight:[Number(padding.right)||0,Number(padding.bottom)||0]}
        : {padding:Math.max(.05,Number(padding)||.15)};
      this.map.stop();
      this.map.fitBounds(bounds, options);
    }
    removeLayer(handle) { if (handle?.remove) handle.remove(); }
    invalidateSize() { setTimeout(() => this.map.invalidateSize(), 120); }
    remove() { this.markers?.forEach(marker => marker.remove()); this.routes?.forEach(route => route.remove()); this.markers?.clear(); this.routes?.clear(); this.map.remove(); }
  }

  class MapboxAdapter {
    constructor(container, center, zoom) {
      this.backend = 'mapbox';
      mapboxgl.accessToken = MAPBOX_TOKEN;
      this.map = new mapboxgl.Map({
        container, style: DEFAULT_STYLE,
        center: [Number(center[1]), Number(center[0])],
        zoom, attributionControl: false,
        antialias: false, fadeDuration: 0,
        pitchWithRotate: false, dragRotate: false,
        // Android WebView changes its visual viewport while the software keyboard opens/closes.
        // Resize manually after that transition instead of resizing Mapbox mid-animation.
        trackResize: false
      });
      this._resizeTimer = 0;
      this._resizeHandler = () => {
        if (this._resizeTimer) clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => {
          this._resizeTimer = 0;
          this.map?.resize();
        }, 320);
      };
      window.addEventListener('resize', this._resizeHandler, {passive:true});
      window.visualViewport?.addEventListener('resize', this._resizeHandler, {passive:true});
      this.map.addControl(new mapboxgl.AttributionControl({
        compact:false,
        customAttribution:'<a href="https://www.geoapify.com/" target="_blank" rel="noopener">Powered by Geoapify</a>'
      }), 'bottom-right');
      this.map.addControl(new mapboxgl.NavigationControl({showCompass:false}), 'top-right');
      this.markers = new Map();
      this.routes = new Map();
    }
    onClick(callback) {
      this.map.on('click', event => callback({lat:event.lngLat.lat, lon:event.lngLat.lng}));
    }
    onUserMove(callback) {
      const events = ['dragstart','zoomstart','rotatestart','pitchstart'];
      const handler = (event,name) => { if(name==='dragstart'||event?.originalEvent)callback(event); };
      const handlers=new Map(events.map(name=>[name,event=>handler(event,name)]));
      const container=this.map.getContainer();
      const zoomClick=event=>{if(event.target?.closest?.('.mapboxgl-ctrl-zoom-in,.mapboxgl-ctrl-zoom-out'))callback(event)};
      const wheel=event=>callback(event),touch=event=>callback(event);
      events.forEach(name=>this.map.on(name,handlers.get(name)));
      container.addEventListener('click',zoomClick);
      container.addEventListener('wheel',wheel,{passive:true});
      container.addEventListener('touchmove',touch,{passive:true});
      return () => {
        events.forEach(name=>this.map?.off(name,handlers.get(name)));
        container.removeEventListener('click',zoomClick);
        container.removeEventListener('wheel',wheel);
        container.removeEventListener('touchmove',touch);
      };
    }
    addHeadingMarker(id, point, heading = 0) {
      this.removeMarker(id);
      const element=document.createElement('div');
      element.className='dante-driver-heading';
      element.innerHTML='<svg viewBox="0 0 34 34" width="42" height="42" aria-hidden="true"><path d="M17 2.5 29 30 17 23.2 5 30Z" fill="#18a86b" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/></svg>';
      Object.assign(element.style,{width:'42px',height:'42px',display:'grid',placeItems:'center',filter:'drop-shadow(0 2px 4px #001b0d99)'});
      const marker=new mapboxgl.Marker({element,anchor:'center',rotationAlignment:'viewport',pitchAlignment:'viewport'}).setLngLat([Number(point.lon),Number(point.lat)]).addTo(this.map);
      let currentHeading=Number(heading)||0,markerFrame=0,currentLngLat=[Number(point.lon),Number(point.lat)];
      const updateRotation=()=>marker.setRotation(currentHeading-(this.map?.getBearing?.()||0));
      const setLatLng=next=>{
        if(markerFrame)cancelAnimationFrame(markerFrame);
        const from=currentLngLat.slice(),to=[Number(next.lon),Number(next.lat)];let startedAt=0;
        const step=now=>{
          if(!startedAt)startedAt=now;
          const t=Math.max(0,Math.min(1,(now-startedAt)/850)),eased=1-Math.pow(1-t,3);
          currentLngLat=[from[0]+(to[0]-from[0])*eased,from[1]+(to[1]-from[1])*eased];
          marker.setLngLat(currentLngLat);
          if(t<1)markerFrame=requestAnimationFrame(step);else markerFrame=0;
        };
        markerFrame=requestAnimationFrame(step);
      };
      this.map.on('rotate',updateRotation);
      const handle={setLatLng,setHeading:value=>{currentHeading=Number(value)||0;updateRotation()},remove:()=>{if(markerFrame)cancelAnimationFrame(markerFrame);this.map?.off('rotate',updateRotation);marker.remove();this.markers.delete(id)}};
      handle.setHeading(heading);
      this.markers.set(id,handle);
      return handle;
    }
    addMarker(id, point, popup) {
      this.removeMarker(id);
      const marker = new mapboxgl.Marker({color:'#168447'})
        .setLngLat([Number(point.lon), Number(point.lat)]);
      if (popup) marker.setPopup(new mapboxgl.Popup({offset:18}).setText(popup));
      marker.addTo(this.map);
      const handle = {
        setLatLng: next => marker.setLngLat([Number(next.lon), Number(next.lat)]),
        remove: () => { marker.remove(); this.markers.delete(id); }
      };
      this.markers.set(id, handle);
      return handle;
    }
    addCircleMarker(id, point, options = {}) {
      this.removeMarker(id);
      const element=document.createElement('div');
      const diameter=Math.max(12,(options.radius||9)*2);
      Object.assign(element.style,{width:diameter+'px',height:diameter+'px',borderRadius:'50%',border:(options.weight||3)+'px solid '+(options.color||'#fff'),background:options.fillColor||'#176b3a',opacity:String(options.fillOpacity??1),boxShadow:'0 1px 5px #0008'});
      const marker=new mapboxgl.Marker({element,anchor:'center'}).setLngLat([Number(point.lon),Number(point.lat)]).addTo(this.map);
      if(options.popup)marker.setPopup(new mapboxgl.Popup({offset:14}).setText(options.popup));
      let markerFrame=0,currentLngLat=[Number(point.lon),Number(point.lat)];
      const handle={
        setLatLng:next=>{
          if(markerFrame)cancelAnimationFrame(markerFrame);
          const from=currentLngLat.slice(),to=[Number(next.lon),Number(next.lat)];let startedAt=0;
          const step=now=>{
            if(!startedAt)startedAt=now;
            const t=Math.max(0,Math.min(1,(now-startedAt)/850)),eased=1-Math.pow(1-t,3);
            currentLngLat=[from[0]+(to[0]-from[0])*eased,from[1]+(to[1]-from[1])*eased];
            marker.setLngLat(currentLngLat);
            if(t<1)markerFrame=requestAnimationFrame(step);else markerFrame=0;
          };
          markerFrame=requestAnimationFrame(step);
        },
        remove:()=>{if(markerFrame)cancelAnimationFrame(markerFrame);marker.remove();this.markers.delete(id)}
      };
      this.markers.set(id,handle);
      return handle;
    }
    removeMarker(id) { const marker = this.markers.get(id); if (marker) marker.remove(); }
    addTripEndpointMarker(id, point, kind = 'pickup', popup = '') {
      this.removeMarker(id);
      if (!validPoint(point)) return null;
      const pickup = kind === 'pickup';
      const color = pickup ? '#ed9418' : '#dc3545';
      const svg = pickup
        ? '<svg viewBox="0 0 40 48" width="34" height="42" aria-hidden="true"><path d="M20 2C9.5 2 2 9.6 2 19.2 2 31 20 46 20 46s18-15 18-26.8C38 9.6 30.5 2 20 2Z" fill="'+color+'" stroke="#fff" stroke-width="2.4"/><circle cx="20" cy="16" r="5" fill="#fff"/><path d="M10.5 30c.8-6 4.2-9 9.5-9s8.7 3 9.5 9" fill="#fff"/></svg>'
        : '<svg viewBox="0 0 40 48" width="34" height="42" aria-hidden="true"><path d="M20 2C9.5 2 2 9.6 2 19.2 2 31 20 46 20 46s18-15 18-26.8C38 9.6 30.5 2 20 2Z" fill="'+color+'" stroke="#fff" stroke-width="2.4"/><circle cx="20" cy="19" r="6" fill="#fff"/></svg>';
      const element = document.createElement('div');
      element.className = 'dante-trip-endpoint-icon';
      element.innerHTML = svg;
      Object.assign(element.style,{width:'34px',height:'42px',display:'block',filter:'drop-shadow(0 2px 3px #001b0d66)'});
      const marker = new mapboxgl.Marker({element,anchor:'bottom',clickTolerance:3})
        .setLngLat([Number(point.lon),Number(point.lat)]);
      if (popup) marker.setPopup(new mapboxgl.Popup({offset:28}).setText(popup));
      marker.addTo(this.map);
      const handle = {
        setLatLng: next => marker.setLngLat([Number(next.lon),Number(next.lat)]),
        remove: () => { marker.remove(); this.markers.delete(id); }
      };
      this.markers.set(id,handle);
      return handle;
    }
    addRoute(id, geometry, style = {}) {
      this.removeRoute(id);
      const sourceId = 'dante-route-' + String(id).replace(/[^a-z0-9_-]/gi, '-');
      const layerId = sourceId + '-line';
      const glowLayerId = layerId + '-glow';
      let cancelled = false,glowLayerAdded=false,progressFrame=0,progressValue=Math.max(0,Math.min(1,Number(style.progress)||0)),lastProgressPaintAt=0;
      let currentGradient = style.gradient || (style.progress !== undefined ? buildProgressGradient(style.progress, style) : null);
      const add = () => {
        if (cancelled || !this.map || !this.map.isStyleLoaded()) return;
        if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
        if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
        this.map.addSource(sourceId, {
          type:'geojson',
          data:{type:'Feature', geometry, properties:{}},
          ...(currentGradient ? {lineMetrics:true} : {})
        });
        if(currentGradient){
          try{
            this.map.addLayer({id:glowLayerId,type:'line',source:sourceId,layout:{'line-cap':'round','line-join':'round'},paint:{'line-gradient':currentGradient,'line-width':style.glowWidth||15,'line-blur':style.glowBlur||4,'line-opacity':style.glowOpacity??.22}});
            glowLayerAdded=true;
          }catch(error){console.warn('No se pudo crear el halo de navegación; se conserva la línea principal:',error)}
        }
        const paint={'line-width':style.weight||6,'line-opacity':style.opacity??.96};
        if(currentGradient)paint['line-gradient']=currentGradient;else paint['line-color']=style.color||'#168447';
        this.map.addLayer({id:layerId,type:'line',source:sourceId,layout:{'line-cap':'round','line-join':'round'},paint});
      };
      if (this.map.isStyleLoaded()) add(); else this.map.once('load', add);
      const paintGradient=expression=>{
        currentGradient=expression;
        if(glowLayerAdded&&this.map?.getLayer(glowLayerId)){try{this.map.setPaintProperty(glowLayerId,'line-gradient',expression)}catch(error){console.warn('No se pudo actualizar el halo de navegación:',error)}}
        if(this.map?.getLayer(layerId))this.map.setPaintProperty(layerId,'line-gradient',expression);
      };
      const handle={
        setGradient:expression=>{if(progressFrame)cancelAnimationFrame(progressFrame);progressFrame=0;paintGradient(expression)},
        setProgress:value=>{
          const target=Math.max(0,Math.min(1,Number(value)||0)),from=progressValue;
          if(progressFrame)cancelAnimationFrame(progressFrame);
          let startedAt=0;
          const animateProgress=now=>{
            if(!startedAt)startedAt=now;
            const t=Math.max(0,Math.min(1,(now-startedAt)/850)),eased=1-Math.pow(1-t,3);
            progressValue=from+(target-from)*eased;
            if(now-lastProgressPaintAt>=40||t>=1){paintGradient(buildProgressGradient(progressValue,style));lastProgressPaintAt=now}
            if(t<1)progressFrame=requestAnimationFrame(animateProgress);else progressFrame=0;
          };
          progressFrame=requestAnimationFrame(animateProgress);
        },
        remove:()=>{
          cancelled=true;if(progressFrame)cancelAnimationFrame(progressFrame);
          this.map?.off('load',add);
          if(!this.map)return;
          if(this.map.getLayer(layerId))this.map.removeLayer(layerId);
          if(this.map.getLayer(glowLayerId))this.map.removeLayer(glowLayerId);
          if(this.map.getSource(sourceId))this.map.removeSource(sourceId);
        }
      };
      this.routes.set(id, handle);
      return handle;
    }
    addRoutePreview(id, legs, options = {}) {
      this.removeRoute(id);
      const validLegs = (legs || []).filter(leg => leg?.geometry && geoCoordinates(leg.geometry).length > 1);
      if (!validLegs.length) return null;
      const palette = [
        {base:'#facc15',highlight:'#ef4444'},
        {base:'#16a34a',highlight:'#4ade80'}
      ];
      const routeLayers = validLegs.map((leg,index) => {
        const colors = palette[index] || palette[1];
        const sourceId = 'dante-route-' + String(id).replace(/[^a-z0-9_-]/gi, '-') + '-leg-' + index;
        const baseLayerId = sourceId + '-base';
        const glowLayerId = sourceId + '-glow';
        const gradientLayerId = sourceId + '-gradient';
        let currentGradient = buildMovingGradient(0,colors.base,colors.highlight);
        let gradientLayerAdded = false,glowLayerAdded=false;
        return {
          sourceId,baseLayerId,gradientLayerId,colors,leg,
          add:() => {
            this.map.addSource(sourceId,{
              type:'geojson',
              lineMetrics:true,
              data:{type:'Feature',geometry:leg.geometry,properties:{}}
            });
            // Keep a visible route underneath the animated layer. If a WebView
            // rejects line-gradient, the route itself must remain visible.
            try{
              this.map.addLayer({id:glowLayerId,type:'line',source:sourceId,layout:{'line-cap':'round','line-join':'round'},paint:{'line-gradient':currentGradient,'line-width':(Number(options.weight)||6)+10,'line-blur':4,'line-opacity':.22}});
              glowLayerAdded=true;
            }catch(error){console.warn('No se pudo crear el halo de la previsualización:',error)}
            this.map.addLayer({
              id:baseLayerId,type:'line',source:sourceId,
              layout:{'line-cap':'round','line-join':'round'},
              paint:{'line-color':colors.base,'line-width':(Number(options.weight)||6)+3,'line-opacity':.3}
            });
            try {
              this.map.addLayer({
                id:gradientLayerId,type:'line',source:sourceId,
                layout:{'line-cap':'round','line-join':'round'},
                paint:{'line-gradient':currentGradient,'line-width':options.weight||6,'line-opacity':options.opacity??.98}
              });
              gradientLayerAdded=true;
            } catch (error) {
              console.warn('Mapbox no pudo crear la capa de gradiente; se conserva la trazada base:',error);
            }
          },
          setGradient:(expression,fallbackColor) => {
            currentGradient = expression;
            if (!this.map?.getLayer(baseLayerId)) return;
            if(glowLayerAdded&&this.map.getLayer(glowLayerId)){
              try{this.map.setPaintProperty(glowLayerId,'line-gradient',expression)}catch(error){console.warn('No se pudo actualizar el halo de la previsualización:',error)}
            }
            if (gradientLayerAdded && this.map.getLayer(gradientLayerId)) {
              try {
                this.map.setPaintProperty(gradientLayerId,'line-gradient',expression);
                return;
              } catch (error) {
                console.warn('No se pudo actualizar el gradiente de la ruta; se usa el color animado de respaldo:',error);
                gradientLayerAdded = false;
              }
            }
            if (fallbackColor) {
              try { this.map.setPaintProperty(baseLayerId,'line-color',fallbackColor); }
              catch (error) { console.warn('No se pudo actualizar el color de respaldo de la ruta:',error); }
            }
          },
          remove:() => {
            if (!this.map) return;
            if (this.map.getLayer(gradientLayerId)) this.map.removeLayer(gradientLayerId);
            if (this.map.getLayer(baseLayerId)) this.map.removeLayer(baseLayerId);
            if (this.map.getLayer(glowLayerId)) this.map.removeLayer(glowLayerId);
            if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
          }
        };
      });
      let cancelled = false, frame = 0;
      const addLayers = () => {
        if (cancelled || !this.map) return;
        // isStyleLoaded() can become false after adding a source/layer. Check it
        // once, then add every leg in the same style-ready transaction; checking
        // between legs can strand leg 2 waiting for the one-shot initial "load".
        if (!this.map.isStyleLoaded()) {
          this.map.once('idle',addLayers);
          return;
        }
        try {
          routeLayers.forEach(routeLayer => routeLayer.add());
        } catch (error) {
          console.warn('No se pudieron crear todas las capas de la ruta previa:',error);
          routeLayers.forEach(routeLayer => {
            try { routeLayer.remove(); } catch {}
          });
        }
      };
      if (this.map.isStyleLoaded()) addLayers();
      else this.map.once('idle',addLayers);

      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
      let arrowMarker = null, currentBearing = 0, currentLeg = 0, nextLeg = 0, startedAt = 0, pausedUntil = 0, lastFrameAt = 0;
      const updateRotation = () => arrowMarker?.setRotation(currentBearing - (this.map?.getBearing?.() || 0));
      if (!reduceMotion) {
        const element = document.createElement('div');
        element.className = 'dante-driver-preview-arrow';
        element.innerHTML = '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><path d="M20 2.5 35 36 20 27 5 36Z M20 12 24 29 20 25.5 16 29Z" fill="#198754" fill-rule="evenodd"/><path d="M20 2.5 35 36 20 27 5 36Z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg>';
        Object.assign(element.style,{width:'40px',height:'40px',display:'grid',placeItems:'center',filter:'drop-shadow(0 2px 4px #001b0d99)'});
        const first = routePositionAt(validLegs[0].geometry,0);
        if (first) {
          arrowMarker = new mapboxgl.Marker({element,anchor:'center',rotationAlignment:'viewport',pitchAlignment:'viewport'})
            .setLngLat(first.coordinates).addTo(this.map);
          this.map.on('rotate',updateRotation);
        }
      }
      const referenceDuration = Math.max(1200,Number(options.durationMs)||2600);
      const referenceLength = Math.max(1,routeGeometryLengthMeters(validLegs[0].geometry));
      const metersPerMs = referenceLength / referenceDuration;
      const legDurations = validLegs.map(leg => Math.max(1,routeGeometryLengthMeters(leg.geometry)) / metersPerMs);
      const pause = Math.max(100,Number(options.pauseMs)||240);
      const animate = now => {
        if (cancelled || !this.map) return;
        if (currentLeg < 0) {
          if (now < pausedUntil) { frame = requestAnimationFrame(animate); return; }
          currentLeg = nextLeg;
          startedAt = now;
        } else if (!startedAt) startedAt = now;
        if (now - lastFrameAt >= 40) {
          lastFrameAt = now;
          const duration = legDurations[currentLeg] || referenceDuration;
          const progress = Math.max(0,Math.min(1,(now-startedAt)/duration));
          const colors = palette[currentLeg] || palette[1];
          routeLayers[currentLeg]?.setGradient(
            buildMovingGradient(progress,colors.base,colors.highlight),
            movingGradientColorAt(progress,colors.base,colors.highlight)
          );
          const position = routePositionAt(validLegs[currentLeg].geometry,progress);
          if (position && arrowMarker) {
            arrowMarker.setLngLat(position.coordinates);
            currentBearing = position.bearing;
            updateRotation();
          }
          if (progress >= 1) {
            nextLeg = validLegs.length > 1 ? (currentLeg + 1) % validLegs.length : 0;
            currentLeg = -1;
            pausedUntil = now + pause;
          }
        }
        frame = requestAnimationFrame(animate);
      };
      if (!reduceMotion) frame = requestAnimationFrame(animate);
      const handle = {
        remove:() => {
          cancelled = true;
          this.map?.off('idle',addLayers);
          if (frame) cancelAnimationFrame(frame);
          this.map?.off('rotate',updateRotation);
          arrowMarker?.remove();
          routeLayers.forEach(routeLayer => routeLayer.remove());
        }
      };
      this.routes.set(id,handle);
      return handle;
    }
    setRouteProgress(id,progress) { this.routes.get(id)?.setProgress?.(progress); }
    removeRoute(id) { const route = this.routes.get(id); if (route) { route.remove(); this.routes.delete(id); } }
    fitPoints(points, padding = .15) {
      const valid = (points || []).filter(validPoint);
      if (!valid.length) return;
      if (valid.length === 1) {
        this.map.jumpTo({center:[Number(valid[0].lon),Number(valid[0].lat)],zoom:16});
        return;
      }
      const bounds = new mapboxgl.LngLatBounds();
      valid.forEach(point => bounds.extend([Number(point.lon),Number(point.lat)]));
      const fitPadding = padding && typeof padding === 'object'
        ? {top:Number(padding.top)||0,bottom:Number(padding.bottom)||0,left:Number(padding.left)||0,right:Number(padding.right)||0}
        : Math.max(24,Math.round(48 + (Number(padding)||.15) * 100));
      this.map.fitBounds(bounds,{padding:fitPadding,maxZoom:16,animate:false,duration:0});
    }
    followLocation(point, bearing) {
      if (!validPoint(point) || !this.map) return;
      const options = {center:[Number(point.lon), Number(point.lat)], zoom:Math.max(this.map.getZoom(),16), pitch:48, duration:900, essential:true};
      if (bearing !== null && bearing !== undefined && Number.isFinite(Number(bearing))) options.bearing = Number(bearing);
      this.map.easeTo(options);
    }
    setBearing(bearing) {
      if(this.map&&Number.isFinite(Number(bearing)))this.map.easeTo({bearing:Number(bearing),duration:260,essential:true});
    }
    fitGeometry(geometry, padding = .15, includePoints = []) {
      const coordinates = geoCoordinates(geometry);
      if (!coordinates.length) return;
      const bounds = new mapboxgl.LngLatBounds();
      coordinates.forEach(point => bounds.extend(point));
      (includePoints||[]).filter(validPoint).forEach(point=>bounds.extend([Number(point.lon),Number(point.lat)]));
      const fitPadding = padding && typeof padding === 'object'
        ? {top:Number(padding.top)||0,bottom:Number(padding.bottom)||0,left:Number(padding.left)||0,right:Number(padding.right)||0}
        : Math.max(24,Math.round(48 + (Number(padding)||.15) * 100));
      const requestedBearing=padding&&typeof padding==='object'&&padding.bearing!==null&&padding.bearing!==undefined&&Number.isFinite(Number(padding.bearing))?Number(padding.bearing):0;
      const fitOptions={padding:fitPadding,maxZoom:16,animate:false,duration:0,bearing:requestedBearing,pitch:0};
      this.map.stop();
      this.map.fitBounds(bounds,fitOptions);
    }
    removeLayer(handle) { if (handle?.remove) handle.remove(); }
    invalidateSize() {
      if (this._resizeTimer) { clearTimeout(this._resizeTimer); this._resizeTimer = 0; }
      requestAnimationFrame(() => this.map?.resize());
    }
    remove() {
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      window.removeEventListener('resize', this._resizeHandler);
      window.visualViewport?.removeEventListener('resize', this._resizeHandler);
      this.markers.forEach(marker => marker.remove());
      this.routes.forEach(route => route.remove());
      this.markers.clear(); this.routes.clear();
      this.map?.remove(); this.map = null;
    }
  }

  function create(container, center, zoom, locationIqKey) {
    let supported = false;
    try { supported = !!(window.mapboxgl && MAPBOX_TOKEN && mapboxgl.supported()); }
    catch (error) { console.warn('No se pudo comprobar WebGL2; se usará Leaflet:', error); }
    if (supported) {
      try { return new MapboxAdapter(container, center, zoom); }
      catch (error) { console.warn('Mapbox no pudo inicializarse; se usará el mapa alternativo:', error); }
    }
    return new LeafletAdapter(container, center, zoom, locationIqKey);
  }

  async function getGeoapifyDrivingRoute(points, options = {}) {
    const waypoints = points.map(point => Number(point.lat) + ',' + Number(point.lon)).join('|');
    const params = new URLSearchParams({
      waypoints,
      mode: 'drive',
      format: 'geojson',
      units: 'metric',
      lang: 'es',
      apiKey: GEOAPIFY_KEY
    });
    if (options.steps === true) params.set('details', 'instruction_details');
    const response = await fetch('https://api.geoapify.com/v1/routing?' + params.toString());
    if (!response.ok) throw new Error('Geoapify Routing ' + response.status);
    const data = await response.json();
    const feature = data.features?.[0];
    const properties = feature?.properties;
    const rawCoordinates = feature?.geometry?.coordinates;
    if (!feature || !properties || !Array.isArray(rawCoordinates)) {
      throw new Error(data.message || 'Geoapify no devolvió una ruta válida.');
    }
    const legLines = feature.geometry.type === 'MultiLineString' ? rawCoordinates : [rawCoordinates];
    const coordinates = [];
    legLines.forEach(line => {
      if (!Array.isArray(line)) return;
      coordinates.push(...(coordinates.length ? line.slice(1) : line));
    });
    let routeLegLines = legLines;
    if (points.length > 2 && legLines.length === 1 && legLines[0].length > points.length - 1) {
      const line = legLines[0];
      routeLegLines = [];
      let startIndex = 0;
      for (let waypointIndex = 1; waypointIndex < points.length - 1; waypointIndex++) {
        const remainingLegs = points.length - 1 - waypointIndex;
        const minIndex = Math.min(line.length - 1, startIndex + 1);
        const maxIndex = Math.max(minIndex, line.length - 1 - remainingLegs);
        let nearestIndex = minIndex, nearestDistance = Infinity;
        for (let index = minIndex; index <= maxIndex; index++) {
          const coordinate = line[index], waypoint = points[waypointIndex];
          const distance = coordinateDistanceMeters(coordinate,[Number(waypoint.lon),Number(waypoint.lat)]);
          if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
        }
        routeLegLines.push(line.slice(startIndex,nearestIndex+1));
        startIndex = nearestIndex;
      }
      routeLegLines.push(line.slice(startIndex));
    }
    const legs = (properties.legs || []).map((leg, legIndex) => {
      const line = routeLegLines[legIndex] || [];
      const stepLine = legLines[legIndex] || line;
      const steps = options.steps === true ? (leg.steps || []).map(step => {
        const from = Math.max(0, Number(step.from_index) || 0);
        const to = Math.max(from, Number(step.to_index) || from);
        const stepCoordinates = stepLine.slice(from, to + 1);
        const location = stepLine[from] || stepLine[to] || null;
        const instruction = step.instruction?.text ||
          step.instruction?.transition_instruction ||
          step.instruction?.pre_transition_instruction ||
          step.name || 'Continuá por la ruta';
        return {
          geometry: {type:'LineString', coordinates:stepCoordinates},
          maneuver: {instruction, location},
          name: step.name || instruction,
          distance: step.distance,
          duration: step.time
        };
      }) : [];
      return {distance:leg.distance, duration:leg.time, geometry:line.length>1?{type:'LineString',coordinates:line}:null, steps};
    });
    if (coordinates.length < 2) throw new Error('Geoapify devolvió una geometría de ruta incompleta.');
    return normalizeRouteLegs({
      geometry: {type:'LineString', coordinates},
      distance: properties.distance,
      duration: properties.time,
      legs,
      provider: 'Geoapify'
    },points);
  }

  async function getMapboxDrivingRoute(points, options = {}) {
    const coordinates = points.map(point => Number(point.lon) + ',' + Number(point.lat)).join(';');
    const url = 'https://api.mapbox.com/directions/v5/mapbox/driving/' + coordinates +
      '?alternatives=false&geometries=geojson&overview=full&steps=' + (options.steps === true ? 'true' : 'false') +
      '&language=es' + (options.steps === true ? '&banner_instructions=true&voice_instructions=true' : '') +
      '&access_token=' + encodeURIComponent(MAPBOX_TOKEN);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Mapbox Directions ' + response.status);
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) {
      throw new Error(data.message || 'Mapbox no devolvió una ruta.');
    }
    const route = data.routes[0];
    const legs = (route.legs || []).map(leg => {
      const coordinates = [];
      (leg.steps || []).forEach(step => {
        const line = step.geometry?.coordinates || [];
        if (!Array.isArray(line)) return;
        coordinates.push(...(coordinates.length ? line.slice(1) : line));
      });
      return {...leg,geometry:coordinates.length>1?{type:'LineString',coordinates}:null};
    });
    return normalizeRouteLegs({...route,legs,provider:'Mapbox'},points);
  }

  async function getDrivingRoute(points, options = {}) {
    if (!Array.isArray(points) || points.length < 2 || points.some(point => !validPoint(point))) {
      throw new Error('Se necesitan al menos dos puntos válidos para calcular la ruta.');
    }
    let geoapifyError = null;
    if (GEOAPIFY_KEY) {
      try {
        return await getGeoapifyDrivingRoute(points, options);
      } catch (error) {
        geoapifyError = error;
        console.warn('Geoapify Routing no respondió; se intentará el proveedor alternativo.', error);
      }
    }
    if (MAPBOX_TOKEN) {
      try {
        return await getMapboxDrivingRoute(points, options);
      } catch (error) {
        if (geoapifyError) throw new Error('Geoapify: ' + geoapifyError.message + ' · Mapbox: ' + error.message);
        throw error;
      }
    }
    throw geoapifyError || new Error('ROUTING_PROVIDER_NOT_CONFIGURED');
  }

  window.DanteMap = Object.freeze({
    create,
    getDrivingRoute,
    normalizeRouteLegs,
    buildMovingGradient,
    buildProgressGradient,
    routeGeometryLengthMeters,
    get backendPreference() { return MAPBOX_TOKEN && window.mapboxgl && mapboxgl.supported() ? 'mapbox' : 'leaflet'; },
    get tokenConfigured() { return !!MAPBOX_TOKEN; },
    get routingProvider() { return GEOAPIFY_KEY ? 'geoapify' : (MAPBOX_TOKEN ? 'mapbox' : 'none'); }
  });
})();
