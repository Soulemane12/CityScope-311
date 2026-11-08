'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CREWS, SCENARIO_INCIDENTS, SKILLS, buildJobs, createDispatchPlan, operationsGeoJSON } from '../lib/dispatch.mjs';
import { createRoadDispatchPlan } from '../lib/road-routing.mjs';
import { config } from '../lib/config';
import ResponsibilityPanel from './responsibility-panel';
import LocalIntake from './local-intake';

const categorySkills = { streets: ['roads', 'electrical', 'trees'], sanitation: ['sanitation'], buildings: ['buildings', 'water'], noise: [], other: [] };
export function useOperations(reports, latest, filters) {
  const [crews, setCrews] = useState(() => DEFAULT_CREWS.map(c => ({ ...c })));
  const [incidents, setIncidents] = useState(() => SCENARIO_INCIDENTS.map(i => ({ ...i })));
  const [settings, setSettings] = useState({ limit: 24, shiftHours: 8, maxStops: 5 });
  const [plan, setPlan] = useState(null);
  const [completed, setCompleted] = useState(() => new Set());
  const [layers, setLayers] = useState({ complaints: true, incidents: true, crews: true, routes: true });
  const [tab, setTab] = useState('queue');
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState(null);
  const [routingMode, setRoutingMode] = useState('road');
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');
  const [progress, setProgress] = useState('');
  const planAbort = useRef(null);
  function invalidatePlan() { planAbort.current?.abort(); setPlan(null); setPlanning(false); setPlanError(''); setProgress(''); }
  useEffect(() => { invalidatePlan(); }, [reports]);
  useEffect(() => () => planAbort.current?.abort(), []);
  const visibleIncidents = useMemo(() => incidents.filter(i =>
    (filters.borough === 'all' || i.borough === filters.borough) &&
    filters.status !== 'closed' && i.ageHours <= Number(filters.days) * 24 &&
    (filters.category === 'all' || categorySkills[filters.category]?.includes(i.skill)) &&
    (!filters.search || `${i.title} ${i.address} ${i.id}`.toLowerCase().includes(filters.search.toLowerCase()))
  ), [incidents, filters]);
  const allAnalysis = useMemo(() => buildJobs(reports, visibleIncidents, latest), [reports, visibleIncidents, latest]);
  const analysis = useMemo(() => ({ ...allAnalysis, jobs: allAnalysis.jobs.filter(j => !completed.has(j.id)) }), [allAnalysis, completed]);
  const geo = useMemo(() => operationsGeoJSON(crews, visibleIncidents, plan, completed), [crews, visibleIncidents, plan, completed]);
  function changeSettings(key, value) { setSettings(s => ({ ...s, [key]: value })); invalidatePlan(); }
  function toggleCrew(id) { setCrews(all => all.map(c => c.id === id ? { ...c, available: !c.available } : c)); invalidatePlan(); }
  function changeRouting(value) { setRoutingMode(value); invalidatePlan(); }
  async function run() {
    if (completed.size || planning) return;
    const controller = new AbortController(); planAbort.current?.abort(); planAbort.current = controller;
    setPlanning(true); setPlanError(''); setPlan(null); setProgress('Preparing dispatch'); setTab('crews');
    try {
      const result = routingMode === 'road' ? await createRoadDispatchPlan(analysis.jobs, crews, settings, {token:config.mapboxToken,signal:controller.signal,onProgress:setProgress}) : createDispatchPlan(analysis.jobs,crews,settings);
      if(!controller.signal.aborted) { setPlan(result); setProgress(''); }
    } catch(e) { if(!controller.signal.aborted) { setPlanError(e.name === 'TimeoutError' ? 'Mapbox road routing timed out. Retry, or explicitly choose Estimated mode.' : e.message || 'Road routing failed. Retry or explicitly choose Estimated mode.'); setProgress(''); } }
    finally { if(!controller.signal.aborted) setPlanning(false); }
  }
  function completeNext(id) {
    const next = plan?.routes.find(r => r.crew.id === id)?.stops.find(s => !completed.has(s.id));
    if (next) setCompleted(old => new Set([...old, next.id]));
  }
  function reset() { setCompleted(new Set()); invalidatePlan(); }
  function addIncident(incident) { setIncidents(old => [...old, { ...incident, id: `LOCAL-${Date.now()}`, source: 'manual', status: 'Open', ageHours: 0 }]); invalidatePlan(); }
  function removeIncident(id) { setIncidents(old => old.filter(i => i.id !== id)); invalidatePlan(); }
  function onPick(coordinates) { setPicked(coordinates); setPicking(false); setTab('incidents'); }
  return { crews, incidents, visibleIncidents, settings, plan, completed, layers, tab, picking, picked, analysis, allAnalysis, geo, routingMode, planning, planError, progress, changeRouting, setTab, setLayers, setPicking, changeSettings, toggleCrew, run, completeNext, reset, addIncident, removeIncident, onPick };
}

export function OperationsToolbar({ ops, busy }) {
  return <div className="operations-toolbar">
    <span className="simulation-badge">Local dispatch simulation</span>
    <div className="layer-options">{Object.entries(ops.layers).map(([key, shown]) => <label key={key}><input type="checkbox" checked={shown} onChange={() => ops.setLayers(l => ({ ...l, [key]: !shown }))} />{key === 'complaints' ? '311 reports' : key[0].toUpperCase() + key.slice(1)}</label>)}</div>
    <label>Top jobs <select aria-label="Maximum priority jobs to consider" value={ops.settings.limit} onChange={e => ops.changeSettings('limit', +e.target.value)}>{[8,16,24,40,60].map(n => <option key={n}>{n}</option>)}</select></label>
    <label>Shift <select aria-label="Simulated shift hours" value={ops.settings.shiftHours} onChange={e => ops.changeSettings('shiftHours', +e.target.value)}>{[2,4,6,8,10,12].map(n => <option key={n} value={n}>{n}h</option>)}</select></label>
    <label>Stops/crew <select aria-label="Maximum stops per crew" value={ops.settings.maxStops} onChange={e => ops.changeSettings('maxStops', +e.target.value)}>{[2,3,4,5,6,8].map(n => <option key={n}>{n}</option>)}</select></label>
    <label>Routing <select aria-label="Routing mode" value={ops.routingMode} onChange={e => ops.changeRouting(e.target.value)}><option value="road">Road · driving time</option><option value="estimated">Estimated · straight lines</option></select></label>
    <button className="dispatch-button" disabled={busy || ops.planning || !ops.analysis.jobs.length || ops.completed.size > 0} title={ops.completed.size ? 'Reset simulation before planning a new shift.' : 'Prioritize jobs, assign crews and build greedy routes.'} onClick={ops.run}>{ops.planning ? 'Routing…' : 'Run dispatch'}</button>
    <button onClick={ops.reset} disabled={!ops.plan && !ops.completed.size && !ops.planning && !ops.planError}>{ops.planning ? 'Cancel routing' : 'Reset simulation'}</button>
  </div>;
}

function PriorityJob({ job, onSelect, assignment, reason }) {
  return <div className="priority-job">
    <button className="job-select" onClick={() => onSelect(job)}><span className={`priority-score ${job.band.toLowerCase()}`}>{job.score}</span><span><strong>{job.title}</strong><span>{job.address}</span><small>{job.source === '311' ? `${job.count} NYC 311 report${job.count > 1 ? 's' : ''}` : job.source === 'simulated' ? 'Simulated infrastructure incident' : 'User-entered simulation'} · {job.skill} · {job.minutes} min</small></span></button>
    <div className="job-meta"><span>{job.band} priority</span>{assignment && <b style={{ color: assignment.color }}>{assignment.crew} / stop {assignment.stop}</b>}</div>
    <details><summary>Why this priority?</summary><p>{job.reasons.join(' · ')}.</p></details>
    {reason && <p className="unassigned-reason">{reason}</p>}
  </div>;
}

export default function OperationsPanel({ ops, reports, busy, error, onSelectJob, onSelectReport, onFocusRoute, refresh, selected }) {
  const [queueLimit, setQueueLimit] = useState(40);
  const assignments = new Map((ops.plan?.routes || []).flatMap(r => r.stops.map((j, i) => [j.id, { crew: r.crew.id, color: r.crew.color, stop: i + 1 }])));
  const completed = ops.completed.size;
  return <aside className="reports-pane operations-pane" aria-label="Dispatch workspace">
    <div className="operations-summary"><div><strong>{ops.analysis.jobs.length}</strong><span>Open repair jobs</span></div><div><strong>{ops.plan?.assigned || 0}</strong><span>Assigned</span></div><div><strong>{completed}</strong><span>Sim. completed</span></div></div>
    <nav className="operations-tabs" aria-label="Dispatch panels">
      {[['queue','Priority'],['crews','Crews']].map(([id, name]) => <button key={id} aria-pressed={ops.tab === id} onClick={() => ops.setTab(id)}>{name}</button>)}
      <select aria-label="More views" value={['incidents','responsibility','reports'].includes(ops.tab) ? ops.tab : ''} onChange={e => e.target.value && ops.setTab(e.target.value)}>
        <option value="">More…</option>
        <option value="incidents">Intake</option>
        <option value="responsibility">Responsibility</option>
        <option value="reports">311 reports</option>
      </select>
    </nav>
    <div className="report-list">
      {ops.planning && <div className="routing-status" role="status">{ops.progress}. Fetching Mapbox road data…</div>}
      {ops.planError && <div className="routing-error" role="alert">{ops.planError}<button onClick={ops.run}>Retry road dispatch</button><p>No estimated route has been substituted.</p></div>}
      {ops.tab === 'responsibility' && <ResponsibilityPanel jobs={ops.allAnalysis.jobs} plan={ops.plan} completed={ops.completed} onSelectJob={onSelectJob} />}
      {ops.tab === 'queue' && <>
        <div className="panel-intro"><strong>Rule-based priority queue</strong><p>Ranks open repair work in the current report filters. Severity, age and repeated reports determine the score.</p><p>{ops.analysis.closed.toLocaleString()} closed reports excluded · {ops.analysis.referral.toLocaleString()} non-repair complaints left for referral · {ops.analysis.merged} duplicates combined.</p></div>
        {busy && <p className="message">{reports.length ? `Loading 311 reports in batches · ${reports.length.toLocaleString()} mapped so far.` : 'Loading 311 reports…'} Scenario incidents are listed below.</p>}
        {error && <div className="message" role="alert">{error}<button onClick={refresh}>Retry reports</button></div>}
        {!ops.analysis.jobs.length && !busy && <p className="message">No open repair jobs in these filters. Try All categories / All statuses or add a scenario incident.</p>}
        {ops.analysis.jobs.slice(0, queueLimit).map(job => <PriorityJob key={job.id} job={job} onSelect={onSelectJob} assignment={assignments.get(job.id)} />)}
        {ops.analysis.jobs.length > queueLimit && <button className="load-more" onClick={() => setQueueLimit(n => n + 40)}>Show more jobs</button>}
        <div className="panel-intro"><details><summary>How dispatch works</summary><ol><li>Severity × 16, plus up to 15 age points and 15 duplicate-report points. Scores are demo estimates.</li><li>Select the highest-scoring jobs, then greedily assign a compatible crew with the smallest added workload.</li><li>Road mode visits the unvisited stop with the shortest driving time, using directed Mapbox Matrix values, then returns to the depot. Estimated mode uses straight-line distance.</li></ol><p>Shift capacity includes travel, estimated repair time, and return to depot. Greedy routes are approximate; they are not guaranteed optimal.</p></details></div>
      </>}
      {ops.tab === 'crews' && <>
        <div className="panel-intro"><strong>Simulated maintenance fleet</strong><p>Availability and specialties constrain assignment. No real crews are contacted.</p>{ops.plan ? <p><b>{ops.plan.assigned}</b> jobs assigned · <b>{ops.plan.unassigned.length}</b> unassigned · <b>{ops.plan.deferred}</b> outside the selected top {ops.settings.limit}.<br />{ops.plan.distanceKm.toFixed(1)} km {ops.plan.mode === 'road' ? 'driving routes' : 'straight-line estimates'} including depot returns.</p> : <p>Select crews, then run dispatch to assign work.</p>}{ops.completed.size > 0 && <p>Reset simulation to start a new shift or replan.</p>}</div>
        {ops.crews.map(crew => {
          const route = ops.plan?.routes.find(r => r.crew.id === crew.id);
          const remaining = route?.stops.filter(j => !ops.completed.has(j.id)) || [];
          return <section key={crew.id} className="crew-card"><header><span className="crew-tag" style={{ background: crew.color }}>{crew.id}</span><strong>{crew.name}</strong><label><input type="checkbox" checked={crew.available} onChange={() => ops.toggleCrew(crew.id)} aria-label={`${crew.name} available`} />Available</label></header><p>{crew.skills.join(' / ')} · Simulated depot</p>
            {route ? <><p className="crew-route-stats">{route.stops.length} stops · {route.distanceKm.toFixed(1)} km · {Math.ceil(route.totalMinutes)} / {ops.settings.shiftHours * 60} min shift</p><button className="view-road-route" onClick={() => onFocusRoute({ geometry: route.geometry || { type: 'LineString', coordinates: [route.crew.coordinates, ...route.stops.map(stop => stop.coordinates), route.crew.coordinates] }, key: `${route.crew.id}-${route.stops.map(stop => stop.id).join('-')}` })}>View route on map</button><ol className="crew-stops">{route.stops.map(job => <li key={job.id} className={ops.completed.has(job.id) ? 'completed-stop' : ''}><button onClick={() => onSelectJob(job)}>{job.title}<small>{job.address}{route.arrivals ? ` · ETA +${Math.ceil(route.arrivals[route.stops.indexOf(job)])} min` : ''}</small></button>{ops.completed.has(job.id) && <span>Done</span>}</li>)}</ol><button className="complete-stop" disabled={!remaining.length} onClick={() => ops.completeNext(crew.id)}>{remaining.length ? 'Simulate completing next stop' : 'All assigned stops completed'}</button></> : <p className="crew-idle">{crew.available ? 'No work assigned.' : 'Unavailable for this plan.'}</p>}
          </section>;
        })}
        {!!ops.plan?.unassigned.length && <><div className="panel-intro"><strong>Unassigned jobs</strong></div>{ops.plan.unassigned.map(job => <PriorityJob key={job.id} job={job} reason={job.reason} onSelect={onSelectJob} />)}</>}
        <div className="panel-intro">{(ops.plan?.mode === 'road' || (!ops.plan && ops.routingMode === 'road')) ? 'Road lines and ETAs come from Mapbox driving routes. Assignment uses road travel time; shifts include repairs and depot return. Arrival offsets start at the simulated shift, not the report date. ETAs are estimates, with no live-traffic profile.' : 'Estimated mode uses schematic straight-line tours. Travel estimates use distance × 1.35 at 20 km/h; roads, bridges and traffic are not modeled.'}</div>
      </>}
      {ops.tab === 'incidents' && <>
        <div className="panel-intro"><strong>Infrastructure scenario</strong><p>Seed incidents and all maintenance resources are simulated. 311 complaints remain public source records.</p></div>
        <IncidentForm ops={ops} />
        {ops.visibleIncidents.map(incident => <div className="incident-row" key={incident.id}><button onClick={() => onSelectJob({ ...incident, incident })}><strong>{incident.title}</strong><span>{incident.address}</span><small>{incident.source === 'simulated' ? 'Simulated' : 'User-entered simulation'} · {incident.skill} · severity {incident.severity}/5</small></button><button aria-label={`Remove ${incident.title}`} onClick={() => ops.removeIncident(incident.id)}>×</button></div>)}
      </>}
      {ops.tab === 'reports' && <>
        <div className="report-heading"><strong>NYC 311 reports</strong><span>{busy ? `${reports.length.toLocaleString()} loaded` : reports.length.toLocaleString()}</span></div>
        {busy && <p className="message">Loading reports in batches…</p>}{error && <div className="message">{error}<button onClick={refresh}>Retry</button></div>}
        {!busy && !error && !reports.length && <p className="message">No reports match these filters.</p>}
        {reports.slice(0, queueLimit).map(r => <button key={r.id} className={`report-row${selected?.id === r.id ? ' selected' : ''}`} onClick={() => onSelectReport(r)}><span className="report-title"><i style={{ background: r.color }} />{r.title}</span><span className="report-address">{r.address}</span><span className="report-meta">{r.borough}<span className={r.isClosed ? 'closed' : ''}>{r.status}</span></span></button>)}
        {reports.length > queueLimit && <button className="load-more" onClick={() => setQueueLimit(n => n + 60)}>Show more reports</button>}
      </>}
    </div>
    <div className="simulation-footer">Rules + greedy routing · {ops.plan?.mode === 'road' ? 'Mapbox driving' : ops.routingMode === 'road' ? 'Road mode' : 'Estimated mode'} · Simulated crews</div>
  </aside>;
}

function IncidentForm({ ops }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', address: '', borough: 'MANHATTAN', skill: 'roads', severity: 3, minutes: 45, lng: '-73.99', lat: '40.74' });
  const [error, setError] = useState('');
  const [intake, setIntake] = useState(null);
  useEffect(() => { if (ops.picked) { setForm(f => ({ ...f, lng: ops.picked[0].toFixed(6), lat: ops.picked[1].toFixed(6) })); setOpen(true); } }, [ops.picked]);
  function submit(e) {
    e.preventDefault(); const lng = +form.lng, lat = +form.lat;
    if (!form.lng.trim() || !form.lat.trim() || !Number.isFinite(lng) || !Number.isFinite(lat) || lng < -74.3 || lng > -73.65 || lat < 40.47 || lat > 40.94) return setError('Choose a location within New York City.');
    if (!form.title.trim() || !form.address.trim()) return setError('Enter an issue and a location label.');
    ops.addIncident({ title: form.title.trim(), address: form.address.trim(), borough: form.borough, skill: form.skill, severity: +form.severity, minutes: +form.minutes, coordinates: [lng, lat], intake: intake ? { ...intake, reviewed: true } : null });
    setForm(f => ({ ...f, title: '', address: '' })); setError(''); setIntake(null); setOpen(false); ops.setPicking(false);
  }
  return <div className="incident-form"><button onClick={() => { setOpen(!open); ops.setPicking(false); }}>{open ? 'Cancel new incident' : '+ Add infrastructure incident'}</button>{open && <form onSubmit={submit}>
    <LocalIntake onUse={proposal => { setForm(f => ({ ...f, title: proposal.title, skill: proposal.skill, severity: proposal.severity, minutes: proposal.minutes })); setIntake(proposal); }} />
    {intake && <p className="intake-applied">Proposal copied below. Review the fields and provide the location before adding.</p>}
    <label>Issue<input required maxLength={120} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Blocked storm drain" /></label>
    <label>Location label<input required maxLength={160} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Address or intersection" /></label>
    <div className="form-columns"><label>Specialty<select value={form.skill} onChange={e => setForm(f => ({ ...f, skill: e.target.value }))}>{SKILLS.map(s => <option key={s}>{s}</option>)}</select></label><label>Borough<select value={form.borough} onChange={e => setForm(f => ({ ...f, borough: e.target.value }))}>{['MANHATTAN','BROOKLYN','QUEENS','BRONX','STATEN ISLAND'].map(b => <option key={b}>{b}</option>)}</select></label></div>
    <div className="form-columns"><label>Severity<select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}</select></label><label>Repair minutes<input required type="number" min={10} max={240} step={1} value={form.minutes} onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))} /></label></div>
    <button type="button" onClick={() => ops.setPicking(!ops.picking)}>{ops.picking ? 'Click a location on the map…' : 'Pick location on map'}</button><div className="form-columns"><label>Longitude<input required inputMode="decimal" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))} /></label><label>Latitude<input required inputMode="decimal" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))} /></label></div>
    {error && <p role="alert">{error}</p>}<button className="dispatch-button" type="submit">Add to simulation</button>
  </form>}</div>;
}

export function IncidentDetails({ incident, onClose }) {
  return <article className="detail full-record" aria-label="Infrastructure incident details"><button className="close" aria-label="Close incident details" onClick={onClose}>×</button><span className="report-id">{incident.id} · {incident.source === 'simulated' ? 'Simulated infrastructure' : 'User-entered simulation'}</span><h2>{incident.title}</h2><p>{incident.address}<br />{incident.borough}</p><dl><dt>Severity</dt><dd>{incident.severity}/5</dd><dt>Specialty</dt><dd>{incident.skill}</dd><dt>Repair time</dt><dd>{incident.minutes} minutes (estimate)</dd><dt>Coordinates</dt><dd>{incident.coordinates[1].toFixed(5)}, {incident.coordinates[0].toFixed(5)}</dd></dl><p>This scenario incident and its maintenance response are simulated.</p></article>;
}
