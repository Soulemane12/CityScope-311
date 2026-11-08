export const INTAKE_SKILLS = ['roads','water','electrical','sanitation','buildings','trees','unknown'];
export const INTAKE_SCHEMA = {
  type:'object', additionalProperties:false,
  properties:{title:{type:'string'},skill:{type:'string',enum:INTAKE_SKILLS},severity:{type:'integer',minimum:1,maximum:5},minutes:{type:'integer',minimum:10,maximum:240},evidence:{type:'array',items:{type:'string'}},uncertainties:{type:'array',items:{type:'string'}},explanation:{type:'string'}},
  required:['title','skill','severity','minutes','evidence','uncertainties','explanation'],
};
export function validateProposal(value, description) {
  if (!value || typeof value !== 'object' || !INTAKE_SKILLS.includes(value.skill) || !Number.isInteger(value.severity) || value.severity<1 || value.severity>5 || !Number.isInteger(value.minutes) || value.minutes<10 || value.minutes>240 || typeof value.title!=='string' || !value.title.trim() || !Array.isArray(value.evidence) || !Array.isArray(value.uncertainties) || typeof value.explanation!=='string') throw new Error('The local model returned an invalid proposal. Please retry or use the labeled rules suggestion.');
  const evidence=value.evidence.filter(s=>typeof s==='string' && s.trim() && description.toLowerCase().includes(s.toLowerCase())).slice(0,6).map(s=>s.slice(0,160));
  const uncertainties=value.uncertainties.filter(s=>typeof s==='string').slice(0,6).map(s=>s.slice(0,250));
  if(!evidence.length)uncertainties.push('No exact supporting excerpt was returned. Review the classification carefully.');
  if(value.skill==='unknown')uncertainties.push('Choose a crew specialty before adding this incident.');
  return {title:value.title.trim().slice(0,120),skill:value.skill,severity:value.severity,minutes:value.minutes,evidence,uncertainties,explanation:value.explanation.slice(0,500),reviewRequired:true};
}

/** Explicit, labeled offline alternative; never presented as model output. */
export function suggestWithRules(description) {
  const text=description.toLowerCase();
  const rules=[
    {pattern:/water|flood|pouring|sewer|drain|hydrant/,skill:'water',title:'Water leak or drainage incident',severity:4,minutes:75},
    {pattern:/signal|electric|wire|sparks|street\s?light/,skill:'electrical',title:'Electrical or signal incident',severity:4,minutes:60},
    {pattern:/tree|branch/,skill:'trees',title:'Tree or branch obstruction',severity:3,minutes:60},
    {pattern:/trash|garbage|dumping|waste|litter/,skill:'sanitation',title:'Sanitation incident',severity:2,minutes:35},
    {pattern:/heat|boiler|elevator|building|mold|mould/,skill:'buildings',title:'Building maintenance incident',severity:3,minutes:75},
    {pattern:/pothole|sinkhole|road|sidewalk|pavement/,skill:'roads',title:'Road or sidewalk damage',severity:3,minutes:45},
  ];
  const match=rules.find(r=>r.pattern.test(text));
  const vulnerability=/school|hospital|elderly|wheelchair|children/.exec(text);
  const urgency=/collapse|sinkhole|flood|pouring|sparks|blocked|fallen/.exec(text);
  const evidence=[match?new RegExp(match.pattern.source,'i').exec(description)?.[0]:null,vulnerability?.[0],urgency?.[0]].filter(Boolean);
  const proposal={title:match?.title||'Unclassified infrastructure incident',skill:match?.skill||'unknown',severity:Math.min(5,(match?.severity||2)+(vulnerability||urgency?1:0)),minutes:match?.minutes||45,evidence,uncertainties:['Location and hazard extent require operator confirmation.','Severity and repair duration are planning estimates.'],explanation:match?`Matched ${match.skill} keywords${vulnerability?' and a potentially vulnerable site':''}.`:'No supported repair type was recognized.'};
  return {...validateProposal(proposal,description),method:'rules',model:null};
}
