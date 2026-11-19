(() => {
  'use strict';

  const MAPBOX_TOKEN = window.DANTE_MAPBOX_TOKEN || '';
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
      this.map = L.map(container).setView([Number(center[0]), Number(center[1])], zoom);
      L.tileLayer('https://tiles.locationiq.com/v3/streets/r/{z}/{x}/{y}.png?key=' +
        encodeURIComponent(locationIqKey), {
          maxZoom: 20,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://locationiq.com">LocationIQ</a>'
        }).addTo(this.map);
    }
    onClick(callback) {
      this.map.on('click', event => callback({lat: event.latlng.lat, lon: event.latlng.lng}));
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
      else if (valid.length > 1) this.map.fitBounds(L.latLngBounds(valid.map(p => [Number(p.lat), Number(p.lon)])).pad(padding));
    }
    followLocation(point) {
      if (!validPoint(point)) return;
      this.map.setView([Number(point.lat), Number(point.lon)], Math.max(this.map.getZoom(), 16), {animate:true, duration:0.45});
    }
    fitGeometry(geometry, padding = .15) {
      const layer = L.geoJSON({type:'Feature', geometry, properties:{}});
      const bounds = layer.getBounds();
      if (bounds.isValid()) this.map.fitBounds(bounds.pad(padding));
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
      this.map.fitBounds(bounds,{padding:Math.max(24,Math.round(48 + padding * 100)),maxZoom:16,animate:false,duration:0});
    }
    followLocation(point, bearing) {
      if (!validPoint(point) || !this.map) return;
      const options = {center:[Number(point.lon), Number(point.lat)], zoom:Math.max(this.map.getZoom(), 16), pitch:48, duration:550, essential:true};
      if (Number.isFinite(Number(bearing))) options.bearing = Number(bearing);
      this.map.easeTo(options);
    }
    fitGeometry(geometry, padding = .15) {
      const coordinates = geoCoordinates(geometry);
      if (!coordinates.length) return;
      const bounds = new mapboxgl.LngLatBounds();
      coordinates.forEach(point => bounds.extend(point));
      this.map.fitBounds(bounds,{padding:Math.max(24,Math.round(48 + padding * 100)),maxZoom:17,animate:false,duration:0});
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

  async function getDrivingRoute(points, options = {}) {
    if (!Array.isArray(points) || points.length < 2 || points.some(point => !validPoint(point))) {
      throw new Error('Se necesitan al menos dos puntos válidos para calcular la ruta.');
    }
    if (!MAPBOX_TOKEN) throw new Error('MAPBOX_TOKEN_NOT_CONFIGURED');
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

  window.DanteMap = Object.freeze({
    create,
    getDrivingRoute,
    get backendPreference() { return MAPBOX_TOKEN && window.mapboxgl && mapboxgl.supported() ? 'mapbox' : 'leaflet'; },
    get tokenConfigured() { return !!MAPBOX_TOKEN; }
  });
})();
