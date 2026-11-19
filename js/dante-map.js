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
    }
    onClick(callback) {
      this.map.on('click', event => callback({lat: event.latlng.lat, lon: event.latlng.lng}));
    }
    onUserMove(callback) {
      const events = ['dragstart','zoomstart'];
      const handler = event => { if (event?.originalEvent) callback(event); };
      events.forEach(name => this.map.on(name, handler));
      return () => events.forEach(name => this.map?.off(name, handler));
    }
    addHeadingMarker(id, point, heading = 0) {
      this.removeMarker(id);
      const element = document.createElement('div');
      element.className = 'dante-driver-heading';
      element.innerHTML = '<svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true"><path d="M17 2.5 29 30 17 23.2 5 30Z" fill="#18a86b" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/></svg>';
      Object.assign(element.style, {width:'34px',height:'34px',display:'grid',placeItems:'center',filter:'drop-shadow(0 2px 4px #001b0d99)',transform:'rotate('+(Number(heading)||0)+'deg)',transformOrigin:'center'});
      const marker = L.marker([Number(point.lat),Number(point.lon)], {icon:L.divIcon({html:element,className:'dante-driver-heading-icon',iconSize:[34,34],iconAnchor:[17,17]}),interactive:false,keyboard:false}).addTo(this.map);
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
    removeRoute(id) { const route = this.routes?.get(id); if (route) { route.remove(); this.routes.delete(id); } }
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
    fitGeometry(geometry, padding = .15) {
      const layer = L.geoJSON({type:'Feature', geometry, properties:{}});
      const bounds = layer.getBounds();
      if (!bounds.isValid()) return;
      const options = padding && typeof padding === 'object'
        ? {paddingTopLeft:[Number(padding.left)||0,Number(padding.top)||0],paddingBottomRight:[Number(padding.right)||0,Number(padding.bottom)||0]}
        : {padding:Math.max(.05,Number(padding)||.15)};
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
        zoom, attributionControl: true,
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
      this.map.addControl(new mapboxgl.NavigationControl({showCompass:false}), 'top-right');
      this.markers = new Map();
      this.routes = new Map();
    }
    onClick(callback) {
      this.map.on('click', event => callback({lat:event.lngLat.lat, lon:event.lngLat.lng}));
    }
    onUserMove(callback) {
      const events = ['dragstart','zoomstart','rotatestart','pitchstart'];
      const handler = event => { if (event?.originalEvent) callback(event); };
      events.forEach(name => this.map.on(name, handler));
      return () => events.forEach(name => this.map?.off(name, handler));
    }
    addHeadingMarker(id, point, heading = 0) {
      this.removeMarker(id);
      const element = document.createElement('div');
      element.className = 'dante-driver-heading';
      element.innerHTML = '<svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true"><path d="M17 2.5 29 30 17 23.2 5 30Z" fill="#18a86b" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/></svg>';
      Object.assign(element.style,{width:'34px',height:'34px',display:'grid',placeItems:'center',filter:'drop-shadow(0 2px 4px #001b0d99)'});
      const marker = new mapboxgl.Marker({element,anchor:'center',rotationAlignment:'viewport',pitchAlignment:'viewport'})
        .setLngLat([Number(point.lon),Number(point.lat)]).addTo(this.map);
      let currentHeading=Number(heading)||0;
      const updateRotation=()=>marker.setRotation(currentHeading-(this.map?.getBearing?.()||0));
      this.map.on('rotate',updateRotation);
      const handle = {
        setLatLng: next => marker.setLngLat([Number(next.lon),Number(next.lat)]),
        setHeading: value => {currentHeading=Number(value)||0;updateRotation()},
        remove: () => {this.map?.off('rotate',updateRotation);marker.remove();this.markers.delete(id)}
      };
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
      const element = document.createElement('div');
      const diameter = Math.max(12, (options.radius || 9) * 2);
      Object.assign(element.style, {
        width: diameter + 'px', height: diameter + 'px', borderRadius: '50%',
        border: (options.weight || 3) + 'px solid ' + (options.color || '#fff'),
        background: options.fillColor || '#176b3a',
        opacity: String(options.fillOpacity ?? 1),
        boxShadow: '0 1px 5px #0008'
      });
      const marker = new mapboxgl.Marker({element, anchor:'center'})
        .setLngLat([Number(point.lon), Number(point.lat)]).addTo(this.map);
      if (options.popup) marker.setPopup(new mapboxgl.Popup({offset:14}).setText(options.popup));
      const handle = {
        setLatLng: next => marker.setLngLat([Number(next.lon), Number(next.lat)]),
        remove: () => { marker.remove(); this.markers.delete(id); }
      };
      this.markers.set(id, handle);
      return handle;
    }
    removeMarker(id) { const marker = this.markers.get(id); if (marker) marker.remove(); }
    addRoute(id, geometry, style = {}) {
      this.removeRoute(id);
      const sourceId = 'dante-route-' + String(id).replace(/[^a-z0-9_-]/gi, '-');
      const layerId = sourceId + '-line';
      let cancelled = false;
      const add = () => {
        if (cancelled || !this.map || !this.map.isStyleLoaded()) return;
        if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
        if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
        this.map.addSource(sourceId, {type:'geojson', data:{type:'Feature', geometry, properties:{}}});
        this.map.addLayer({
          id:layerId, type:'line', source:sourceId,
          layout:{'line-cap':'round','line-join':'round'},
          paint:{
            'line-color':style.color || '#168447',
            'line-width':style.weight || 6,
            'line-opacity':style.opacity ?? .85
          }
        });
      };
      if (this.map.isStyleLoaded()) add(); else this.map.once('load', add);
      const handle = {
        remove: () => {
          cancelled = true;
          if (!this.map) return;
          if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
          if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
        }
      };
      this.routes.set(id, handle);
      return handle;
    }
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
      const options = {center:[Number(point.lon), Number(point.lat)], zoom:Math.max(this.map.getZoom(), 16), pitch:48, duration:550, essential:true};
      if (bearing !== null && bearing !== undefined && Number.isFinite(Number(bearing))) options.bearing = Number(bearing);
      this.map.easeTo(options);
    }
    setBearing(bearing) {
      if(this.map&&Number.isFinite(Number(bearing)))this.map.easeTo({bearing:Number(bearing),duration:260,essential:true});
    }
    fitGeometry(geometry, padding = .15) {
      const coordinates = geoCoordinates(geometry);
      if (!coordinates.length) return;
      const bounds = new mapboxgl.LngLatBounds();
      coordinates.forEach(point => bounds.extend(point));
      const fitPadding = padding && typeof padding === 'object'
        ? {top:Number(padding.top)||0,bottom:Number(padding.bottom)||0,left:Number(padding.left)||0,right:Number(padding.right)||0}
        : Math.max(24,Math.round(48 + (Number(padding)||.15) * 100));
      const fitOptions={padding:fitPadding,maxZoom:17,animate:false,duration:0};
      if(padding&&typeof padding==='object'&&padding.bearing!==null&&padding.bearing!==undefined&&Number.isFinite(Number(padding.bearing)))fitOptions.bearing=Number(padding.bearing);
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
    const legs = (properties.legs || []).map((leg, legIndex) => {
      const line = legLines[legIndex] || [];
      const steps = options.steps === true ? (leg.steps || []).map(step => {
        const from = Math.max(0, Number(step.from_index) || 0);
        const to = Math.max(from, Number(step.to_index) || from);
        const stepCoordinates = line.slice(from, to + 1);
        const location = line[from] || line[to] || null;
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
      return {distance:leg.distance, duration:leg.time, steps};
    });
    if (coordinates.length < 2) throw new Error('Geoapify devolvió una geometría de ruta incompleta.');
    return {
      geometry: {type:'LineString', coordinates},
      distance: properties.distance,
      duration: properties.time,
      legs,
      provider: 'Geoapify'
    };
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
    return {...data.routes[0], provider:'Mapbox'};
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
    get backendPreference() { return MAPBOX_TOKEN && window.mapboxgl && mapboxgl.supported() ? 'mapbox' : 'leaflet'; },
    get tokenConfigured() { return !!MAPBOX_TOKEN; },
    get routingProvider() { return GEOAPIFY_KEY ? 'geoapify' : (MAPBOX_TOKEN ? 'mapbox' : 'none'); }
  });
})();
