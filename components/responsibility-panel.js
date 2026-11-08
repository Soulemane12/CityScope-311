'use client';
import { useMemo, useState } from 'react';
import { responsibilityReport } from '../lib/responsibility.mjs';

const reasonLabels={skills:'No compatible crew',capacity:'Shift / stop capacity',unreachable:'No driving route','outside-top-limit':'Outside selected top jobs','not-planned':'Dispatch not run',unassigned:'Other'};
export default function ResponsibilityPanel({jobs,plan,completed,onSelectJob}) {
  const summary=useMemo(()=>responsibilityReport(jobs,plan,completed),[jobs,plan,completed]);
  const [groupLimit,setGroupLimit]=useState(15),[waitingLimit,setWaitingLimit]=useState(15);
  return <div className="responsibility-panel">
    <div className="panel-intro"><strong>Responsibility & service coverage</strong><p>Tracks the repairable jobs in this view and the current simulated plan. Assignments show planned service; completed stops are marked separately.</p></div>
    <div className="reporting-note"><strong>Complaint volume is reporting activity, not a direct measure of need.</strong><p>Access to 311 and willingness to report can differ across neighborhoods. Low reporting does not establish low need, and high assignment coverage does not establish fairness.</p><p>This view is capped by the loaded source records and active filters. It is not a population-adjusted or citywide assessment.</p></div>
    <div className="responsibility-metrics"><div><b>{summary.total}</b><span>Repair jobs in view</span></div><div><b>{summary.unassignedCritical}</b><span>Severity-5 jobs waiting</span></div><div><b>{summary.oldestPending.toFixed(1)}h</b><span>Oldest unassigned age</span></div><div><b>{summary.medianAge.toFixed(1)}h</b><span>Median job age</span></div></div>
    <div className="panel-intro"><strong>Neighborhood coverage</strong><p>Community boards are used as a neighborhood proxy. Rows with missing board data and simulated incidents are labeled separately. Ages are measured at the source cutoff; scenario ages are simulated.</p></div>
    <div className="coverage-table"><table><thead><tr><th scope="col">Area</th><th scope="col">Jobs</th><th scope="col">Assigned</th><th scope="col">Done</th><th scope="col">Oldest pending</th></tr></thead><tbody>{summary.neighborhoods.slice(0,groupLimit).map(g=><tr key={g.name}><th scope="row">{g.name}{g.source==='simulation'&&<small>Simulated</small>}<span className="coverage-bar"><i style={{width:`${Math.round(g.coverage*100)}%`}} /></span><small>{Math.round(g.coverage*100)}% assigned · median age {g.medianAge.toFixed(1)}h</small></th><td>{g.jobs}</td><td>{g.assigned}</td><td>{g.completed}</td><td>{g.oldestPending==null?'—':`${g.oldestPending.toFixed(1)}h`}</td></tr>)}</tbody></table></div>
    {summary.neighborhoods.length>groupLimit&&<button className="load-more" onClick={()=>setGroupLimit(n=>n+20)}>Show more areas</button>}
    {!summary.neighborhoods.length&&<p className="message">No repair jobs in the current view.</p>}
    <div className="panel-intro"><strong>Why work is unassigned</strong><div className="reason-counts">{Object.entries(summary.reasonCounts).map(([reason,n])=><div key={reason}><span>{reasonLabels[reason]||reason}</span><b>{n}</b></div>)}</div>{!summary.waiting.length&&<p>{plan?'All jobs in view are assigned or simulated complete.':'Run dispatch to inspect assignment decisions.'}</p>}</div>
    <div className="panel-intro"><strong>Longest-waiting unassigned jobs</strong><p>Waiting includes jobs outside the top-job limit. Severity-5 jobs remain visible even when resources cannot serve them.</p></div>
    {summary.waiting.slice(0,waitingLimit).map(job=><div key={job.id} className="waiting-job"><button onClick={()=>onSelectJob(job)}><strong>{job.title}</strong><span>{job.address}</span></button><div><b>{(job.ageHours||0).toFixed(1)}h old</b><span>Priority {job.score} · severity {job.severity}/5</span></div><p>{job.reason}</p></div>)}
    {summary.waiting.length>waitingLimit&&<button className="load-more" onClick={()=>setWaitingLimit(n=>n+20)}>Show more waiting jobs</button>}
  </div>;
}
