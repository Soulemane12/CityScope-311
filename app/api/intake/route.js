import { analyzeLocally, localModels } from '../../../lib/local-intake.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
  try{return Response.json({available:true,models:await localModels()});}
  catch{return Response.json({available:false,models:[],message:'Ollama is not reachable. Start the local Ollama app, or use the labeled rules suggestion.'});}
}
export async function POST(request){
  if(request.headers.get('origin')) { let origin; try { origin=new URL(request.headers.get('origin')); } catch { return Response.json({error:'Invalid request origin.'},{status:403}); } if(!['http:','https:'].includes(origin.protocol)||origin.host!==(request.headers.get('host')||new URL(request.url).host))return Response.json({error:'Request origin must match the local tool.'},{status:403}); }
  let body;try{body=await request.json();}catch{return Response.json({error:'Enter a report description.'},{status:400});}
  if(typeof body.description!=='string'||body.description.trim().length<10||body.description.length>3000)return Response.json({error:'Enter a description between 10 and 3,000 characters.'},{status:400});
  if(body.model!=null && (typeof body.model!=='string'||body.model.length>150))return Response.json({error:'Invalid local model selection.'},{status:400});
  try{return Response.json(await analyzeLocally(body.description.trim(),body.model,{signal:request.signal}));}
  catch(e){return Response.json({error:e.name==='TimeoutError'?'Local inference timed out. Try a shorter description or a smaller installed model.':e.message||'Local inference is unavailable.'},{status:503});}
}
