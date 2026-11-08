/** Local, deterministic dispatch simulation. No real crews are contacted. */
export const SKILLS = ['roads', 'water', 'electrical', 'sanitation', 'buildings', 'trees'];
export const DEFAULT_CREWS = [
  { id: 'R1', name: 'Manhattan roads', skills: ['roads'], coordinates: [-73.991, 40.748], color: '#c77334' },
  { id: 'R2', name: 'Brooklyn roads', skills: ['roads'], coordinates: [-73.985, 40.674], color: '#bb6158' },
  { id: 'W1', name: 'Brooklyn utilities', skills: ['water'], coordinates: [-73.955, 40.652], color: '#387bb5' },
  { id: 'W2', name: 'Queens utilities', skills: ['water', 'electrical'], coordinates: [-73.842, 40.72], color: '#7365b7' },
  { id: 'E1', name: 'Bronx street systems', skills: ['electrical', 'roads'], coordinates: [-73.917, 40.832], color: '#b68a21' },
  { id: 'S1', name: 'Queens sanitation', skills: ['sanitation'], coordinates: [-73.915, 40.747], color: '#2a8a77' },
  { id: 'B1', name: 'Manhattan buildings', skills: ['buildings'], coordinates: [-73.95, 40.802], color: '#a05b98' },
  { id: 'T1', name: 'Staten Island trees', skills: ['trees', 'roads'], coordinates: [-74.1, 40.615], color: '#597d41' },
].map(c => ({ ...c, available: true }));

export const SCENARIO_INCIDENTS = [
  { id: 'SIM-1', title: 'Water main leak', skill: 'water', severity: 5, minutes: 100, coordinates: [-73.954, 40.65], address: 'Flatbush utility scenario', borough: 'BROOKLYN', ageHours: 8 },
  { id: 'SIM-2', title: 'Deep pothole', skill: 'roads', severity: 4, minutes: 45, coordinates: [-73.994, 40.744], address: 'West 23rd Street scenario', borough: 'MANHATTAN', ageHours: 22 },
  { id: 'SIM-3', title: 'Traffic signal failure', skill: 'electrical', severity: 5, minutes: 60, coordinates: [-73.914, 40.834], address: 'Grand Concourse scenario', borough: 'BRONX', ageHours: 2 },
  { id: 'SIM-4', title: 'Blocked storm drain', skill: 'water', severity: 4, minutes: 40, coordinates: [-73.845, 40.716], address: 'Queens Boulevard scenario', borough: 'QUEENS', ageHours: 18 },
  { id: 'SIM-5', title: 'Fallen tree blocking a lane', skill: 'trees', severity: 4, minutes: 75, coordinates: [-74.107, 40.62], address: 'Castleton Avenue scenario', borough: 'STATEN ISLAND', ageHours: 9 },
  { id: 'SIM-6', title: 'Overflowing collection point', skill: 'sanitation', severity: 3, minutes: 30, coordinates: [-73.918, 40.746], address: 'Long Island City scenario', borough: 'QUEENS', ageHours: 30 },
  { id: 'SIM-7', title: 'Damaged sidewalk', skill: 'roads', severity: 3, minutes: 50, coordinates: [-73.981, 40.678], address: 'Park Slope scenario', borough: 'BROOKLYN', ageHours: 42 },
  { id: 'SIM-8', title: 'Building heating failure', skill: 'buildings', severity: 4, minutes: 90, coordinates: [-73.947, 40.806], address: 'East Harlem scenario', borough: 'MANHATTAN', ageHours: 16 },
].map(i => ({ ...i, source: 'simulated', status: 'Open' }));

export function distanceKm(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * radians, dLng = (b[0] - a[0]) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function classify(report) {
  const text = `${report.title} ${report.detail}`.toLowerCase();
  // Dispatch repair work, not police/service complaints or injury emergencies.
  if (/noise|illegal parking|blocked driveway|abandoned vehicle|derelict vehicle|drug|homeless|assault|gas leak|exposed live|downed power/.test(text)) return null;
  if (/traffic signal|street light|streetlight/.test(text)) return { skill: 'electrical', severity: /traffic signal/.test(text) ? 4 : 3, minutes: 50 };
  if (/water\s+main\b|flood|sewer|catch basin|drain|hydrant|water leak|water maintenance/.test(text)) return { skill: 'water', severity: /water\s+main\b|flood/.test(text) ? 5 : /water maintenance/.test(text) && !/leak|sewer|drain|hydrant/.test(text) ? 3 : 4, minutes: 75 };
  if (/pothole|roadway|street condition|sidewalk|curb|highway condition/.test(text)) return { skill: 'roads', severity: /collapse|sinkhole/.test(text) ? 5 : 3, minutes: 45 };
  if (/tree|branch/.test(text)) return { skill: 'trees', severity: /fallen|hanging/.test(text) ? 4 : 2, minutes: 60 };
  if (report.category === 'sanitation') return { skill: 'sanitation', severity: /hazard|dumping/.test(text) ? 4 : 2, minutes: 35 };
  if (report.category === 'buildings') return { skill: 'buildings', severity: /heat|hot water|mold|mould|elevator/.test(text) ? 4 : 3, minutes: 75 };
  return null;
}
export function priorityBand(score) { return score >= 80 ? 'Critical' : score >= 65 ? 'High' : score >= 40 ? 'Moderate' : 'Low'; }

/** Combine same-address, same-problem 311 reports into one repair stop. */
export function buildJobs(reports, incidents, latest, completed = new Set()) {
  const anchor = Date.parse(`${latest || '2026-01-01T00:00:00'}Z`);
  const groups = new Map();
  let closed = 0, referral = 0;
  for (const report of reports) {
    if (report.isClosed) { closed++; continue; }
    const kind = classify(report);
    if (!kind) { referral++; continue; }
    const site = report.address === 'Address unavailable' ? report.coordinates.map(n => n.toFixed(4)).join(',') : report.address.toUpperCase();
    const key = `${report.borough}|${site}|${report.title.toUpperCase()}`;
    let job = groups.get(key);
    if (!job) {
      const ageHours = Math.max(0, (anchor - Date.parse(`${report.created}Z`)) / 3600000) || 0;
      job = { id: `311-${report.id}`, title: report.title, address: report.address, borough: report.borough, coordinates: report.coordinates, source: '311', report, count: 0, ageHours, ...kind };
      job.neighborhood = report.record?.community_board ? `Community board ${report.record.community_board}` : `${report.borough} (board unavailable)`;
      groups.set(key, job);
    }
    job.ageHours = Math.max(job.ageHours, Math.max(0, (anchor - Date.parse(`${report.created}Z`)) / 3600000) || 0);
    job.count++;
  }
  const jobs = [...groups.values(), ...incidents.map(incident => ({ ...incident, count: 1, incident }))].filter(job => !completed.has(job.id));
  for (const job of jobs) {
    const age = Math.min(15, Math.floor(Math.max(0, job.ageHours || 0) / 4));
    const duplicates = Math.min(15, (job.count - 1) * 4);
    job.score = Math.min(100, job.severity * 16 + age + duplicates);
    job.band = priorityBand(job.score);
    job.reasons = [`Severity ${job.severity}/5: ${job.severity * 16} points`, `${Math.round(job.ageHours || 0)}h old: +${age}`, `${job.count} report${job.count === 1 ? '' : 's'} at this site: +${duplicates}`];
  }
  jobs.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { jobs, closed, referral, merged: [...groups.values()].reduce((n, j) => n + j.count - 1, 0) };
}

export function tourDistance(depot, stops) {
  let total = 0, position = depot;
  for (const stop of stops) { total += distanceKm(position, stop.coordinates); position = stop.coordinates; }
  return total + (stops.length ? distanceKm(position, depot) : 0);
}

/** Nearest-neighbor greedy salesman tour, including return to depot. */
export function greedyRoute(depot, jobs) {
  const remaining = [...jobs], stops = [];
  let position = depot;
  while (remaining.length) {
    let nearest = 0;
    for (let i = 1; i < remaining.length; i++) {
      const delta = distanceKm(position, remaining[i].coordinates) - distanceKm(position, remaining[nearest].coordinates);
      if (delta < -1e-9 || (Math.abs(delta) < 1e-9 && (remaining[i].score || 0) > (remaining[nearest].score || 0))) nearest = i;
    }
    const [next] = remaining.splice(nearest, 1);
    stops.push(next); position = next.coordinates;
  }
  return { stops, distanceKm: tourDistance(depot, stops) };
}

export function createDispatchPlan(jobs, crews, { limit = 24, shiftHours = 8, maxStops = 5 } = {}, travel = null) {
  const routes = crews.filter(c => c.available).map(crew => ({ crew, stops: [], distanceKm: 0, serviceMinutes: 0, travelMinutes: 0, totalMinutes: 0 }));
  const unassigned = [], selected = [...jobs].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  // Conservative demo travel estimate: 20 km/h and 1.35 road-distance factor.
  for (const job of selected) {
    const eligible = routes.filter(r => r.crew.skills.includes(job.skill));
    let best, reachable = false;
    for (const route of eligible) {
      if (route.stops.length >= maxStops) continue;
      const tour = travel ? greedyRoadRoute(route.crew.coordinates, [...route.stops, job], travel) : greedyRoute(route.crew.coordinates, [...route.stops, job]);
      if (!tour) continue;
      reachable = true;
      const serviceMinutes = route.serviceMinutes + job.minutes;
      const travelMinutes = travel ? tour.travelMinutes : tour.distanceKm * 1.35 / 20 * 60;
      const totalMinutes = serviceMinutes + travelMinutes;
      if (totalMinutes > shiftHours * 60) continue;
      const addedMinutes = totalMinutes - route.totalMinutes;
      if (!best || addedMinutes < best.addedMinutes) best = { route, ...tour, serviceMinutes, travelMinutes, totalMinutes, addedMinutes };
    }
    if (best) Object.assign(best.route, { stops: best.stops, distanceKm: best.distanceKm, serviceMinutes: best.serviceMinutes, travelMinutes: best.travelMinutes, totalMinutes: best.totalMinutes });
    else unassigned.push({ ...job, reasonCode: !eligible.length ? 'skills' : travel && !reachable && eligible.some(r => r.stops.length < maxStops) ? 'unreachable' : 'capacity', reason: !eligible.length ? `No available crew with ${job.skill} skills.` : travel && !reachable && eligible.some(r => r.stops.length < maxStops) ? 'No complete driving tour to this job and back to a compatible depot.' : 'Compatible crews are at shift or stop capacity.' });
  }
  const used = routes.filter(r => r.stops.length);
  return {
    routes: used, unassigned, considered: selected.length, deferred: Math.max(0, jobs.length - selected.length),
    assigned: used.reduce((n, r) => n + r.stops.length, 0), distanceKm: used.reduce((n, r) => n + r.distanceKm, 0),
    travelMinutes: used.reduce((n, r) => n + r.travelMinutes, 0), settings: { limit, shiftHours, maxStops },
    mode: travel ? 'road' : 'estimated',
  };
}

export function operationsGeoJSON(crews, incidents, plan, completed = new Set()) {
  const collection = features => ({ type: 'FeatureCollection', features });
  const point = (coordinates, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });
  return {
    incidents: collection(incidents.map(i => point(i.coordinates, { id: i.id, title: i.title, color: completed.has(i.id) ? '#83948a' : '#d45245', completed: completed.has(i.id) }))),
    crews: collection(crews.filter(c => c.available).map(c => {
      const route = plan?.routes.find(r => r.crew.id === c.id);
      const finished = route?.stops.filter(s => completed.has(s.id)) || [];
      return point(finished.at(-1)?.coordinates || c.coordinates, { id: c.id, label: c.id, color: c.color });
    })),
    routes: collection((plan?.routes || []).map(r => ({ type: 'Feature', geometry: r.geometry || { type: 'LineString', coordinates: [r.crew.coordinates, ...r.stops.map(s => s.coordinates), r.crew.coordinates] }, properties: { id: r.crew.id, color: r.crew.color } }))),
    stops: collection((plan?.routes || []).flatMap(r => r.stops.map((s, index) => point(s.coordinates, { id: s.id, crew: r.crew.id, stop: String(index + 1), color: completed.has(s.id) ? '#8c9790' : r.crew.color })))),
  };
}

/** Directed travel-time greedy tour. Null matrix pairs remain unreachable. */
export function greedyRoadRoute(depot, jobs, travel) {
  const remaining = [...jobs], stops = [];
  let position = depot, travelMinutes = 0, kilometers = 0;
  while (remaining.length) {
    let best = -1, leg;
    for (let i = 0; i < remaining.length; i++) {
      const nextLeg = travel(position, remaining[i].coordinates);
      if (!nextLeg || !Number.isFinite(nextLeg.minutes) || !Number.isFinite(nextLeg.km)) continue;
      if (best < 0 || nextLeg.minutes < leg.minutes - 1e-9 || (Math.abs(nextLeg.minutes - leg.minutes) < 1e-9 && remaining[i].score > remaining[best].score)) { best = i; leg = nextLeg; }
    }
    if (best < 0) return null;
    const [next] = remaining.splice(best, 1);
    stops.push(next); travelMinutes += leg.minutes; kilometers += leg.km; position = next.coordinates;
  }
  if (stops.length) {
    const back = travel(position, depot);
    if (!back || !Number.isFinite(back.minutes) || !Number.isFinite(back.km)) return null;
    travelMinutes += back.minutes; kilometers += back.km;
  }
  return { stops, distanceKm: kilometers, travelMinutes };
}
