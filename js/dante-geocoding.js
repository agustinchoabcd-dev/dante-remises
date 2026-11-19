(() => {
  'use strict';
  const API_KEY = window.DANTE_GEOAPIFY_KEY || '';
  const BASE_URL = 'https://api.geoapify.com/v1/geocode/';
  const LOCAL_CONTEXT = 'Santa Rosa de Calamuchita, Córdoba, Argentina';
  function requireKey() { if (!API_KEY) throw new Error('GEOAPIFY_API_KEY_NOT_CONFIGURED'); }
  async function request(url) { const response = await fetch(url); if (!response.ok) throw new Error('Geoapify ' + response.status); return response.json(); }
  function normalizeFeature(feature) {
    const properties = feature?.properties || {};
    const lat = Number(properties.lat ?? feature?.geometry?.coordinates?.[1]);
    const lon = Number(properties.lon ?? feature?.geometry?.coordinates?.[0]);
    const label = String(properties.formatted || properties.address_line1 || properties.name || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !label) return null;
    return {lat, lon, label, placeName:String(properties.name || "").trim(), street:String(properties.street || "").trim(), houseNumber:String(properties.housenumber || "").trim(), street2:String(properties.street2 || "").trim(), addressLine1:String(properties.address_line1 || "").trim()};
  }
  async function autocomplete(query) {
    requireKey();
    const url = new URL('autocomplete', BASE_URL);
    url.searchParams.set('text', query.trim() + ', ' + LOCAL_CONTEXT);
    url.searchParams.set('filter', 'countrycode:ar');
    url.searchParams.set('bias', 'proximity:-64.536,-32.071');
    url.searchParams.set('lang', 'es'); url.searchParams.set('limit', '6'); url.searchParams.set('apiKey', API_KEY);
    const data = await request(url);
    return (data.features || []).map(normalizeFeature).filter(Boolean);
  }
  async function reverseDetails(point) {
    requireKey();
    const lat = Number(point?.lat), lon = Number(point?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('INVALID_COORDINATES');
    const url = new URL('reverse', BASE_URL);
    url.searchParams.set('lat', String(lat)); url.searchParams.set('lon', String(lon));
    url.searchParams.set('lang', 'es'); url.searchParams.set('apiKey', API_KEY);
    const data = await request(url);
    return normalizeFeature((data.features || [])[0]);
  }
  async function reverse(point) {
    return (await reverseDetails(point))?.label || null;
  }
  window.DanteGeocoding = Object.freeze({autocomplete, reverse, reverseDetails, get configured(){return !!API_KEY;}});
})();
