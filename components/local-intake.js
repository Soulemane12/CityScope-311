'use client';
import { useEffect, useRef, useState } from 'react';
import { suggestWithRules } from '../lib/intake.mjs';

export default function LocalIntake({onUse}) {
  const [description,setDescription]=useState('');
  const [models,setModels]=useState([]),[model,setModel]=useState('');
  const [status,setStatus]=useState('Checking local model…'),[proposal,setProposal]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const requestRef=useRef(null);
  async function checkModels(signal) {
    try {
      const response=await fetch('/api/intake',{signal,cache:'no-store'}),data=await response.json();
      if(signal?.aborted)return;
      setModels(data.models||[]);setModel(m=>(data.models||[]).some(x=>x.name===m)?m:data.models?.[0]?.name||'');
      setStatus(data.models?.length?'Local Ollama model ready':data.message||'No installed local model found.');
    }catch(e){if(e.name!=='AbortError'){setModels([]);setStatus('Local AI is unavailable. Start Ollama and check again.');}}
  }
  useEffect(()=>{const controller=new AbortController();checkModels(controller.signal);return()=>{controller.abort();requestRef.current?.abort();};},[]);
  async function analyze(method) {
    setError('');setProposal(null);
    if(description.trim().length<10)return setError('Describe the incident in at least 10 characters.');
    if(method==='rules'){setProposal({...suggestWithRules(description.trim()),description:description.trim()});return;}
    const controller=new AbortController();requestRef.current?.abort();requestRef.current=controller;setBusy(true);
    try {
      const response=await fetch('/api/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:description.trim(),model}),signal:controller.signal});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Local inference failed.');
      if(!controller.signal.aborted)setProposal({...data,description:description.trim()});
    }catch(e){if(e.name!=='AbortError')setError(e.message);}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  return <section className="local-intake"><h3>Describe an incident</h3><p>Local AI proposes a classification. You review it and supply the location before adding it to the simulation.</p>
    <label>Description<textarea aria-label="Incident description for local AI" maxLength={3000} rows={4} disabled={busy} value={description} onChange={e=>{setDescription(e.target.value);setProposal(null);}} placeholder="Water pouring into the street near a school…" /></label>
    <div className="local-model-status">{status}<button type="button" disabled={busy} onClick={()=>checkModels()}>Check Ollama</button></div>
    {!!models.length&&<label>Installed local model<select disabled={busy} value={model} onChange={e=>setModel(e.target.value)}>{models.map(m=><option key={m.name} value={m.name}>{m.name}</option>)}</select></label>}
    <div className="intake-actions"><button type="button" disabled={busy||!model} onClick={()=>analyze('model')}>{busy?'Analyzing locally…':'Analyze with local AI'}</button><button type="button" disabled={busy} onClick={()=>analyze('rules')}>Rules suggestion</button></div>
    {error&&<p className="intake-error" role="alert">{error}</p>}
    {proposal&&<div className="proposal-review"><span className="simulation-badge">{proposal.method==='model'?`Local model: ${proposal.model}`:'Rules suggestion · not model output'}</span><h4>{proposal.title}</h4><dl><dt>Specialty</dt><dd>{proposal.skill}</dd><dt>Severity</dt><dd>{proposal.severity}/5</dd><dt>Repair time</dt><dd>{proposal.minutes} min estimate</dd></dl><p>{proposal.explanation}</p>
      {!!proposal.evidence.length&&<div className="proposal-evidence"><strong>Supporting phrases</strong>{proposal.evidence.map((e,i)=><blockquote key={i}>{e}</blockquote>)}</div>}
      <strong>Needs confirmation</strong><ul>{proposal.uncertainties.map((u,i)=><li key={i}>{u}</li>)}</ul>
      <button type="button" disabled={proposal.skill==='unknown'} onClick={()=>onUse(proposal)}>Use proposal in editable form</button><p>Nothing has been added or dispatched. The fields below remain editable.</p>
    </div>}
  </section>;
}
