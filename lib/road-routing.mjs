import { createDispatchPlan, greedyRoadRoute } from './dispatch.mjs';

const key = point => point.map(n => n.toFixed(6)).join(',');
const matrixCache = new Map();
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const timeoutSignal = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);

async function mapboxJson(url, signal, fetchImpl) {
  const response = await fetchImpl(url, { signal: timeoutSignal(signal) });
  let data;
  try { data = await response.json(); } catch { throw new Error('Mapbox returned an unreadable routing response.'); }
  if (!response.ok || !['Ok','NoRoute'].includes(data.code)) {
    if (response.status === 401 || response.status === 403) throw new Error('Mapbox did not authorize road routing. Check your token’s navigation access and allowed localhost URL.');
    if (response.status === 429) throw new Error('Mapbox routing rate limit reached. Wait a minute and try again.');
    throw new Error(`Mapbox routing failed (${response.status}). ${String(data.message || data.code || '').slice(0,160)}`);
  }
  return data;
}

/** Assemble asymmetric blocks of at most 24 coordinates (12 sources + 12 destinations). */
export async function loadDrivingMatrix(points, { token, signal, onProgress = () => {}, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('A Mapbox public token is required for driving routes.');
  const cacheKey = points.map(key).join(';');
  const cached = matrixCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 300000) { onProgress('Using cached driving times'); return cached.value; }
  const n = points.length, durations = Array.from({ length: n }, () => Array(n).fill(null)), distances = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) { durations[i][i] = 0; distances[i][i] = 0; }
  if (n < 2) return { durations, distances };
  const groups = chunks(points.map((_, i) => i), 12);
  let done = 0;
  for (const sources of groups) for (const destinations of groups) {
    if (signal?.aborted) throw signal.reason;
    const indices = [...new Set([...sources, ...destinations])];
    if (indices.length === 1) { done++; continue; }
    const url = new URL(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${indices.map(i => points[i].join(',')).join(';')}`);
    url.searchParams.set('sources', sources.map(i => indices.indexOf(i)).join(';'));
    url.searchParams.set('destinations', destinations.map(i => indices.indexOf(i)).join(';'));
    url.searchParams.set('annotations', 'duration,distance'); url.searchParams.set('access_token', token);
    onProgress(`Driving time matrix ${++done}/${groups.length ** 2}`);
    const data = await mapboxJson(url, signal, fetchImpl);
    if (data.code === 'NoRoute') continue;
    if (data.durations?.length !== sources.length || data.distances?.length !== sources.length) throw new Error('Mapbox returned an incomplete driving matrix.');
    sources.forEach((from, i) => destinations.forEach((to, j) => {
      const duration = data.durations[i]?.[j], distance = data.distances[i]?.[j];
      if (typeof duration === 'number' && Number.isFinite(duration) && typeof distance === 'number' && Number.isFinite(distance) && duration >= 0 && distance >= 0) { durations[from][to] = duration; distances[from][to] = distance; }
    }));
  }
  const value = { durations, distances };
  if (matrixCache.size >= 5) matrixCache.delete(matrixCache.keys().next().value);
  matrixCache.set(cacheKey, { time: Date.now(), value });
  return value;
}

export async function createRoadDispatchPlan(jobs, crews, settings, { token, signal, onProgress = () => {}, fetchImpl = fetch } = {}) {
  const selected = [...jobs].sort((a,b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, settings.limit);
  const unique = new Map([...crews.filter(c => c.available).map(c => c.coordinates), ...selected.map(j => j.coordinates)].map(p => [key(p), p]));
  const points = [...unique.values()], index = new Map(points.map((p,i) => [key(p),i]));
  if (!crews.some(c => c.available) || !selected.length) return { ...createDispatchPlan(jobs, crews, settings), mode: 'road', routedAt: new Date().toISOString() };
  const matrix = await loadDrivingMatrix(points, { token, signal, onProgress, fetchImpl });
  const travel = (from, to) => {
    const i = index.get(key(from)), j = index.get(key(to));
    const seconds = matrix.durations[i]?.[j], meters = matrix.distances[i]?.[j];
    return seconds == null || meters == null ? null : { minutes: seconds / 60, km: meters / 1000 };
  };
  const plan = createDispatchPlan(jobs, crews, settings, travel), routed = [];
  for (const [routeIndex, route] of plan.routes.entries()) {
    let stops = route.stops;
    while (stops.length) {
      onProgress(`Road geometry ${routeIndex + 1}/${plan.routes.length}: ${route.crew.id}`);
      const coordinates = [route.crew.coordinates, ...stops.map(j => j.coordinates), route.crew.coordinates];
      const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates.map(p => p.join(',')).join(';')}`);
      url.searchParams.set('geometries','geojson'); url.searchParams.set('overview','full'); url.searchParams.set('steps','false'); url.searchParams.set('access_token',token);
      const data = await mapboxJson(url, signal, fetchImpl), road = data.routes?.[0];
      if (data.code === 'NoRoute' || !road) { plan.unassigned.push(...stops.map(j => ({ ...j, reasonCode: 'unreachable', reason: 'Mapbox found no driving route through the assigned stops.' }))); break; }
      if (road.geometry?.type !== 'LineString' || !Array.isArray(road.geometry.coordinates) || !Number.isFinite(road.duration) || road.duration < 0 || !Number.isFinite(road.distance) || road.distance < 0 || road.legs?.length !== stops.length + 1 || !road.legs.every(l => Number.isFinite(l.duration) && l.duration >= 0)) throw new Error('Mapbox returned incomplete road geometry or travel times.');
      const serviceMinutes = stops.reduce((n,j) => n+j.minutes,0), totalMinutes = serviceMinutes + road.duration / 60;
      if (totalMinutes > settings.shiftHours * 60) {
        const lowest = [...stops].sort((a,b) => a.score-b.score || b.id.localeCompare(a.id))[0];
        plan.unassigned.push({ ...lowest, reasonCode: 'capacity', reason: 'The final road ETA plus repairs and depot return exceed this crew’s shift.' });
        const tour = greedyRoadRoute(route.crew.coordinates, stops.filter(j => j.id !== lowest.id), travel);
        if (!tour) { plan.unassigned.push(...stops.filter(j=>j.id!==lowest.id).map(j=>({...j,reasonCode:'unreachable',reason:'No complete driving tour after the shift adjustment.'}))); break; }
        stops = tour.stops; continue;
      }
      let elapsed = 0;
      const arrivals = stops.map((j,i) => { elapsed += road.legs[i].duration / 60; const arrival = elapsed; elapsed += j.minutes; return arrival; });
      routed.push({ ...route, stops, arrivals, serviceMinutes, travelMinutes: road.duration / 60, totalMinutes, distanceKm: road.distance / 1000, geometry: road.geometry });
      break;
    }
  }
  return { ...plan, routes: routed, mode: 'road', profile: 'mapbox/driving', assigned: routed.reduce((n,r)=>n+r.stops.length,0), distanceKm: routed.reduce((n,r)=>n+r.distanceKm,0), travelMinutes: routed.reduce((n,r)=>n+r.travelMinutes,0), routedAt: new Date().toISOString() };
}
