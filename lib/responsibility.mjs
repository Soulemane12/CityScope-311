export function responsibilityReport(jobs, plan, completed = new Set()) {
  const assigned = new Set((plan?.routes || []).flatMap(r => r.stops.map(j => j.id)));
  const considered = new Set([...assigned, ...(plan?.unassigned || []).map(j=>j.id)]);
  const reasons = new Map((plan?.unassigned || []).map(j => [j.id, j]));
  const groups = new Map(), waiting = [];
  const reasonCounts = {};
  for (const job of jobs) {
    const neighborhood = job.neighborhood || `${job.borough || 'Unspecified'} · ${job.source === '311' ? 'board unavailable' : 'simulation'}`;
    let group = groups.get(neighborhood);
    if (!group) { group = { name: neighborhood, source: job.source === '311' ? '311' : 'simulation', jobs: 0, assigned: 0, completed: 0, ages: [], pendingAges: [] }; groups.set(neighborhood,group); }
    group.jobs++; group.ages.push(job.ageHours || 0);
    if (assigned.has(job.id)) group.assigned++;
    if (completed.has(job.id)) group.completed++;
    else group.pendingAges.push(job.ageHours || 0);
    if (!assigned.has(job.id) && !completed.has(job.id)) {
      const why = reasons.get(job.id);
      const reasonCode = !plan ? 'not-planned' : why?.reasonCode || (!considered.has(job.id) ? 'outside-top-limit' : 'unassigned');
      const reason = !plan ? 'Dispatch has not been run.' : why?.reason || 'Outside the selected top-job limit.';
      waiting.push({ ...job, reasonCode, reason });
      reasonCounts[reasonCode] = (reasonCounts[reasonCode] || 0) + 1;
    }
  }
  const median = values => { const a=[...values].sort((a,b)=>a-b), m=Math.floor(a.length/2); return !a.length ? 0 : a.length%2 ? a[m] : (a[m-1]+a[m])/2; };
  const neighborhoods = [...groups.values()].map(g => ({ name: g.name, source:g.source, jobs:g.jobs, assigned:g.assigned, completed:g.completed, coverage:g.jobs ? g.assigned/g.jobs : 0, medianAge:median(g.ages), oldestPending:g.pendingAges.length ? Math.max(...g.pendingAges) : null })).sort((a,b)=>b.jobs-a.jobs || a.name.localeCompare(b.name));
  waiting.sort((a,b)=>b.ageHours-a.ageHours || b.score-a.score || a.id.localeCompare(b.id));
  return { neighborhoods, waiting, reasonCounts, unassignedCritical:waiting.filter(j=>j.severity===5).length, medianAge:median(jobs.map(j=>j.ageHours||0)), oldestPending:waiting.length?Math.max(...waiting.map(j=>j.ageHours||0)):0, assigned:jobs.filter(j=>assigned.has(j.id)).length, total:jobs.length, completed:jobs.filter(j=>completed.has(j.id)).length };
}
