'use client';

import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, normalizeReport, buildLatestReportUrl, buildReportsUrl, toGeoJSON } from '../lib/reports.mjs';
import { config } from '../lib/config';
import ReportDetails from './report-details';
import OperationsPanel, { useOperations, OperationsToolbar, IncidentDetails } from './operations-panel';

const DEFAULT_FILTERS = { days: 1, borough: 'all', status: 'all', category: 'all', search: '' };
const HOME = [-73.965, 40.735];
const count = n => n.toLocaleString('en-US');
const label = text => String(text).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const snapshotKey = 'nyc311-report-snapshot-v1';
const filterKey = filters => JSON.stringify(filters);
function compactReport(report) {
  return {
    id: report.id, title: report.title, detail: report.detail, address: report.address,
    borough: report.borough, zip: report.zip, status: report.status, isClosed: report.isClosed,
    agency: report.agency, agencyName: report.agencyName, created: report.created,
    closed: report.closed, coordinates: report.coordinates, category: report.category,
    color: report.color, record: { community_board: report.record?.community_board },
  };
}
function date(raw, full = false) {
  if (!raw) return '—';
  const value = new Date(raw + 'Z');
  if (!Number.isFinite(value.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(full ? { year: 'numeric', hour: 'numeric', minute: '2-digit' } : {}), timeZone: 'UTC' }).format(value) + (full ? ' ET' : '');
}
async function readJson(url, signal) {
  const proxyUrl = new URL('/api/reports', window.location.origin);
  proxyUrl.searchParams.set('source', url);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(proxyUrl, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) });
    if (response.ok) return response.json();
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    throw new Error(response.status === 429 ? 'NYC Open Data is busy. Try again shortly.' : `NYC Open Data returned ${response.status}.`);
  }
  throw new Error('NYC Open Data is busy. Try again shortly.');
}

function syncOperations(map, ops) {
  for (const [key, data] of Object.entries(ops.geo)) map.getSource(`ops-${key}`)?.setData(data);
  for (const [key, ids] of Object.entries({ incidents: ['incident-points','incident-labels'], crews: ['crew-points','crew-labels'], routes: ['route-casing','route-lines','stop-points','stop-labels'] })) {
    for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', ops.layers[key] ? 'visible' : 'none');
  }
  map.getCanvas().style.cursor = ops.picking ? 'crosshair' : '';
  if (map.getLayer('route-lines')) map.setPaintProperty('route-lines', 'line-dasharray', ops.plan?.mode === 'road' ? null : [2,1]);
}

function MapCanvas({ reports, selected, onSelect, mode, ops, focusRoute, busy, dataError, dataProgress, capped }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const reportsRef = useRef(reports);
  const selectRef = useRef(onSelect);
  const modeRef = useRef(mode);
  const selectedRef = useRef(selected);
  const opsRef = useRef(ops);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { reportsRef.current = reports; selectRef.current = onSelect; modeRef.current = mode; selectedRef.current = selected; opsRef.current = ops; });

  useEffect(() => {
    if (!container.current) return;
    setError('');
    setLoaded(false);
    let map, resizeObserver, disposed = false, timeout, layersReady = false;
    function fail(message) {
      if (disposed) return;
      console.warn('311 map:', message);
      setError(message);
      clearTimeout(timeout);
    }
    async function initialize() {
    try {
      console.info('311 map initializing');
      const gl = await import('mapbox-gl/esm');
      if (disposed) return;
      if (!gl.supported()) throw new Error('Map requires WebGL. Enable hardware acceleration or use another browser.');
      map = new gl.Map({ container: container.current, accessToken: config.mapboxToken, style: 'mapbox://styles/mapbox/light-v11', center: HOME, zoom: 10.6, minZoom: 8, maxZoom: 19, maxBounds: [[-74.65, 40.25], [-73.25, 41.2]], projection: 'mercator' });
      mapRef.current = map;
      console.info('311 map canvas:', container.current.clientWidth, 'x', container.current.clientHeight);
      map.addControl(new gl.NavigationControl({ showCompass: false }), 'top-right');
      let visible = false;
      resizeObserver = new ResizeObserver(() => {
        map.resize();
        if (!visible && container.current.clientHeight > 0) {
          visible = true;
          console.info('311 map visible:', container.current.clientWidth, 'x', container.current.clientHeight);
        }
      });
      resizeObserver.observe(container.current);
      timeout = setTimeout(() => {
        if (!layersReady) fail('Map style is taking too long to load. Check your connection and retry.');
      }, 25000);
      function installDataLayers() {
        if (disposed || layersReady) return;
        layersReady = true;
        clearTimeout(timeout);
        setLoaded(true);
        setError('');
        console.info('311 map overlays ready:', Math.round(container.current.clientWidth), 'x', Math.round(container.current.clientHeight));
        map.addSource('reports', { type: 'geojson', data: toGeoJSON(reportsRef.current) });
        map.addLayer({ id: 'heat', type: 'heatmap', source: 'reports', layout: { visibility: modeRef.current === 'heat' ? 'visible' : 'none' }, paint: { 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 12, 15, 35], 'heatmap-opacity': 0.8, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, '#b8dfcf', 0.5, '#4a9b7d', 0.8, '#efcd6d', 1, '#de6747'] } });
        map.addLayer({ id: 'points', type: 'circle', source: 'reports', layout: { visibility: modeRef.current === 'points' ? 'visible' : 'none' }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 11, 4.5, 15, 7], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.25, 'circle-opacity': 0.9 } });
        map.addLayer({ id: 'selected', type: 'circle', source: 'reports', filter: ['==', ['get', 'id'], selectedRef.current?.id || ''], paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#222', 'circle-stroke-width': 2 } });
        for (const [key, data] of Object.entries(opsRef.current.geo)) map.addSource(`ops-${key}`, { type: 'geojson', data });
        map.addLayer({ id: 'route-casing', type: 'line', source: 'ops-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': .95 } }, 'points');
        map.addLayer({ id: 'route-lines', type: 'line', source: 'ops-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get','color'], 'line-width': 5, 'line-dasharray': [2,1] } }, 'points');
        map.addLayer({ id: 'incident-points', type: 'circle', source: 'ops-incidents', paint: { 'circle-radius': 9, 'circle-color': ['get','color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
        map.addLayer({ id: 'incident-labels', type: 'symbol', source: 'ops-incidents', layout: { 'text-field': '!', 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });
        map.addLayer({ id: 'stop-points', type: 'circle', source: 'ops-stops', paint: { 'circle-radius': 11, 'circle-color': ['get','color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
        map.addLayer({ id: 'stop-labels', type: 'symbol', source: 'ops-stops', layout: { 'text-field': ['get','stop'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });
        map.addLayer({ id: 'crew-points', type: 'circle', source: 'ops-crews', paint: { 'circle-radius': 15, 'circle-color': ['get','color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
        map.addLayer({ id: 'crew-labels', type: 'symbol', source: 'ops-crews', layout: { 'text-field': ['get','label'], 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });
        syncOperations(map, opsRef.current);
        map.setLayoutProperty('points', 'visibility', opsRef.current.layers.complaints && modeRef.current === 'points' ? 'visible' : 'none');
        map.setLayoutProperty('heat', 'visibility', opsRef.current.layers.complaints && modeRef.current === 'heat' ? 'visible' : 'none');
        map.on('click', 'points', e => { if (opsRef.current.picking) return; const report = reportsRef.current.find(r => r.id === e.features[0].properties.id); if (report) selectRef.current(report); });
        map.on('click', 'incident-points', e => { if (opsRef.current.picking) return; const incident = opsRef.current.visibleIncidents.find(i => i.id === e.features[0].properties.id); if (incident) selectRef.current({ ...incident, isIncident: true }); });
        map.on('click', 'crew-points', () => { if (!opsRef.current.picking) opsRef.current.setTab('crews'); });
        map.on('click', 'stop-points', e => {
          if (opsRef.current.picking) return;
          const job = opsRef.current.plan?.routes.flatMap(r => r.stops).find(j => j.id === e.features[0].properties.id);
          if (job) selectRef.current(job.source === '311' ? job.report : { ...job.incident, isIncident: true });
        });
        map.on('click', e => { if (opsRef.current.picking) opsRef.current.onPick([e.lngLat.lng, e.lngLat.lat]); });
        for (const layer of ['points','incident-points','crew-points','stop-points']) {
          map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = opsRef.current.picking ? 'crosshair' : 'pointer'; });
          map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = opsRef.current.picking ? 'crosshair' : ''; });
        }
      }
      // Add local GeoJSON overlays as soon as the style is ready. The map's
      // `load` event also waits for the first rendered frame, including tiles.
      map.on('style.load', installDataLayers);
      map.on('load', installDataLayers);
      map.on('error', e => {
        const message = e.error?.message || '';
        if (!layersReady && /401|403|token|unauthorized|forbidden/i.test(message)) fail('Mapbox authorization failed. The public token must allow this localhost URL.');
        else if (!layersReady) console.warn('311 map resource error:', message.replace(/access_token=[^&\s]+/g, 'access_token=[redacted]'));
      });
    } catch (e) { fail(e.message); }
    }
    initialize();
    return () => { disposed = true; clearTimeout(timeout); resizeObserver?.disconnect(); map?.remove(); mapRef.current = null; };
  }, [retry]);

  useEffect(() => { const map = mapRef.current; if (map?.getSource('reports')) map.getSource('reports').setData(toGeoJSON(reports)); }, [reports]);
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer('points')) { map.setLayoutProperty('points', 'visibility', ops.layers.complaints && mode === 'points' ? 'visible' : 'none'); map.setLayoutProperty('heat', 'visibility', ops.layers.complaints && mode === 'heat' ? 'visible' : 'none'); }
  }, [mode, ops.layers.complaints]);
  useEffect(() => { if (mapRef.current?.getSource('ops-crews')) syncOperations(mapRef.current, ops); }, [ops.geo, ops.layers, ops.picking]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('selected')) return;
    map.setFilter('selected', ['==', ['get', 'id'], selected?.id || '']);
    if (selected) map.flyTo({ center: selected.coordinates, offset: [window.innerWidth > 650 ? 160 : 100, 0], zoom: Math.max(14, map.getZoom()), duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650 });
  }, [selected]);
  useEffect(() => {
    const map = mapRef.current;
    const coordinates = focusRoute?.geometry?.coordinates;
    if (!map || !coordinates?.length) return;
    const valid = coordinates.filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (!valid.length) return;
    const lngs = valid.map(point => point[0]), lats = valid.map(point => point[1]);
    const width = map.getContainer().clientWidth, height = map.getContainer().clientHeight;
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
      padding: { top: Math.min(90, height * .15), bottom: Math.min(110, height * .2), left: Math.min(width > 650 ? 390 : 24, width * .35), right: Math.min(90, width * .15) }, maxZoom: 16, duration: 550,
    });
  }, [focusRoute]);

  return <div className="map-pane">
    <div ref={container} className="map" aria-label="Map of NYC 311 reports" />
    <div className="map-report-count" role="status" aria-live="polite">
      <strong>{reports.length.toLocaleString()}</strong>
      <span>{!ops.layers.complaints ? '311 reports loaded · layer hidden' : mode === 'heat' ? '311 reports in density view' : '311 points on map'}</span>
      <small>{busy
        ? `${dataProgress.batch ? `Batch ${dataProgress.batch}` : 'Starting'} · ${dataProgress.received.toLocaleString()} source records checked`
        : dataError
          ? reports.length ? `Partial load · ${dataProgress.received.toLocaleString()} source records checked` : 'Reports could not be loaded'
          : capped ? '5,000-record source cap reached · narrow filters for more' : dataProgress.received ? `${dataProgress.received.toLocaleString()} source records checked` : 'Waiting for NYC Open Data'}</small>
    </div>
    {!loaded && !error && <div className="map-message">Loading map…</div>}
    {error && <div className="map-message" role="alert">{error}<button onClick={() => setRetry(n => n + 1)}>Retry map</button></div>}
    {ops.picking && <div className="map-pick-banner">Click the map to place an infrastructure incident.<button onClick={() => ops.setPicking(false)}>Cancel</button></div>}
    <button className="reset-map" onClick={() => mapRef.current?.flyTo({ center: HOME, zoom: 10.6, bearing: 0, pitch: 0, duration: 0 })}>Reset view</button>
    <div className="legend" aria-label="Map legend">{mode === 'points' ? CATEGORIES.filter(c => c.id !== 'all').map(c => <span key={c.id}><i style={{ background: c.color }} />{c.label}</span>) : <><span>Density</span><div className="density-gradient" /><span>Low → High</span></>}<span><i style={{ background: "#d45245" }} />Infrastructure (sim.)</span><span>R1/W1/etc. = simulated crews · numbers = route stops</span></div>
  </div>;
}

export default function ReportMap() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');
  const [reports, setReports] = useState([]);
  const [dataProgress, setDataProgress] = useState({ batch: 0, received: 0, done: false });
  const [selected, setSelected] = useState(null);
  const [latest, setLatest] = useState(null);
  const latestRef = useRef(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState('points');
  const [focusRoute, setFocusRoute] = useState(null);
  const [capped, setCapped] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(false);
  const previousFilterKey = useRef(filterKey(DEFAULT_FILTERS));
  const ops = useOperations(reports, latest, filters);
  function selectJob(job) { setSelected(job.source === '311' ? job.report : { ...job.incident, isIncident: true }); }

  useEffect(() => { const timer = setTimeout(() => setFilters(f => f.search === search ? f : { ...f, search }), 400); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    try {
      const snapshot = JSON.parse(sessionStorage.getItem(snapshotKey) || 'null');
      if (snapshot?.filterKey === filterKey(filters) && Array.isArray(snapshot.reports) && snapshot.latest) {
        latestRef.current = snapshot.latest;
        setLatest(snapshot.latest);
        setReports(snapshot.reports);
        setCapped(Boolean(snapshot.capped));
        setSavedSnapshot(true);
      }
    } catch { /* A stale or unavailable browser cache must not block live data. */ }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const key = filterKey(filters);
    if (previousFilterKey.current !== key) {
      setReports([]); setSelected(null); setSavedSnapshot(false);
      previousFilterKey.current = key;
    }
    setBusy(true); setError('');
    setDataProgress({ batch: 0, received: 0, done: false });
    async function load() {
      try {
        let timestamp = latestRef.current;
        if (!timestamp) {
          const response = await readJson(buildLatestReportUrl(), controller.signal);
          timestamp = response[0]?.created_date;
          if (!timestamp) throw new Error('The source did not return a report date.');
          latestRef.current = timestamp; setLatest(timestamp);
        }
        const unique = new Map();
        const pageSize = 500;
        let received = 0;
        for (let offset = 0; offset < 5000; offset += pageSize) {
          const rows = await readJson(buildReportsUrl(filters, timestamp, { limit: pageSize, offset }), controller.signal);
          if (controller.signal.aborted) return;
          if (!Array.isArray(rows)) throw new Error('Unexpected response from NYC Open Data.');
          rows.forEach(row => { const report = normalizeReport(row); if (report) unique.set(report.id, report); });
          received += rows.length;
          const mapped = [...unique.values()];
          setReports(mapped);
          setDataProgress({ batch: Math.floor(offset / pageSize) + 1, received, done: false });
          setCapped(received >= 5000);
          console.info('311 report batch:', JSON.stringify({ asOf: timestamp, offset, received, mapped: mapped.length }));
          try {
            sessionStorage.setItem(snapshotKey, JSON.stringify({ filterKey: key, latest: timestamp, reports: mapped.map(compactReport), capped: received >= 5000 }));
            setSavedSnapshot(true);
          } catch { /* Storage limits do not affect the live map. */ }
          if (rows.length < pageSize) break;
        }
        setDataProgress({ batch: Math.ceil(received / pageSize), received, done: true });
        if (!unique.size && filters.borough === 'all' && filters.status === 'all' && filters.category === 'all' && !filters.search.trim()) throw new Error('NYC Open Data returned no geolocated reports for this date window. Refresh to reconnect to the latest available reports.');
      } catch (e) { if (!controller.signal.aborted) { setDataProgress(p => ({ ...p, done: true })); setError(e.name === 'TimeoutError' ? 'NYC Open Data timed out. Try again.' : e.message); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }
    load(); return () => controller.abort();
  }, [filters, revision]);
  useEffect(() => { function keydown(e) { if (e.key === 'Escape') setSelected(null); } window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown); }, []);

  function filter(key, value) { setFilters(f => ({ ...f, [key]: value })); }
  function refresh() { latestRef.current = null; setRevision(n => n + 1); }
  function reset() { setSearch(''); setFilters(DEFAULT_FILTERS); }

  return <main className="tool">
    <header className="toolbar">
      <h1>NYC 311</h1>
      <input className="search" type="search" aria-label="Search address, issue or report ID" placeholder="Address, issue or report ID" value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Borough" value={filters.borough} onChange={e => filter('borough', e.target.value)}><option value="all">All boroughs</option>{['MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN ISLAND'].map(b => <option key={b} value={b}>{label(b)}</option>)}</select>
      <select aria-label="Time range" title="Time ranges end at the newest source report" value={filters.days} onChange={e => filter('days', Number(e.target.value))}><option value={1}>Latest 24 hours</option><option value={7}>Latest 7 days</option><option value={30}>Latest 30 days</option></select>
      <select aria-label="Category" value={filters.category} onChange={e => filter('category', e.target.value)}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.id === 'all' ? 'All categories' : c.label}</option>)}</select>
      <select aria-label="Status" value={filters.status} onChange={e => filter('status', e.target.value)}><option value="all">All statuses</option><option value="open">Active</option><option value="closed">Closed</option></select>
      <div className="view-toggle"><button aria-pressed={mode === 'points'} onClick={() => setMode('points')}>Points</button><button aria-pressed={mode === 'heat'} onClick={() => setMode('heat')}>Heatmap</button></div>
      <button onClick={reset} title="Clear all filters">Clear</button>
      <button onClick={refresh} disabled={busy}>Refresh</button>
    </header>
    <OperationsToolbar ops={ops} busy={busy} />
    <div className="content">
      <OperationsPanel ops={ops} reports={reports} busy={busy} error={error} onSelectJob={selectJob} onSelectReport={setSelected} onFocusRoute={setFocusRoute} refresh={refresh} selected={selected} />
      <section className="map-section" aria-label="Report locations">
        <MapCanvas reports={reports} selected={selected} onSelect={setSelected} mode={mode} ops={ops} focusRoute={focusRoute} busy={busy} dataError={error} dataProgress={dataProgress} capped={capped} />
        {selected && (selected.isIncident ? <IncidentDetails incident={selected} onClose={() => setSelected(null)} /> : <ReportDetails key={selected.id} report={selected} onClose={() => setSelected(null)} />)}
      </section>
    </div>
    <footer><a href="https://data.cityofnewyork.us/d/erm2-nwe9" target="_blank" rel="noopener noreferrer">NYC Open Data</a><span>{error ? reports.length ? `Showing ${savedSnapshot ? 'saved' : 'loaded'} reports · ${count(reports.length)}` : 'Data unavailable' : latest ? `As of ${date(latest, true)}` : 'Connecting…'}</span><span title="Only reports with coordinates are shown. A closed record does not necessarily mean the condition was resolved.">{capped ? 'Newest 5,000 matches · refine filters for more' : 'Geolocated reports'} · simulated crews and infrastructure · {ops.plan?.mode === 'road' ? 'Mapbox driving routes' : ops.routingMode === 'road' ? 'Road routing selected' : 'Estimated routes'}</span></footer>
  </main>;
}
