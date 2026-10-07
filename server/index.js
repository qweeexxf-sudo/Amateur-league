require('dotenv').config();
const express=require('express');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const app=express();
const allowedOrigin=process.env.ADMIN_ORIGIN||'https://qweeexxf-sudo.github.io';
app.use((req,res,next)=>{const origin=req.headers.origin;if(origin===allowedOrigin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS')}if(req.method==='OPTIONS')return res.sendStatus(204);next()});
app.use(express.json({limit:'32kb'}));
app.use(express.static(path.join(__dirname,'../public')));

const dataDir=path.join(__dirname,'../data');
const db=path.join(dataDir,'matches.json');
const steamGuardPath=path.join(dataDir,'steam-guard-code.json');
const botStatusPath=path.join(dataDir,'bot-status.json');
fs.mkdirSync(dataDir,{recursive:true});
function read(){try{return JSON.parse(fs.readFileSync(db,'utf8'))}catch{return []}}
function write(rows){const tmp=db+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rows,null,2));fs.renameSync(tmp,db)}
function auth(req,res,next){
  const token=process.env.ADMIN_TOKEN;
  if(!token) return res.status(503).json({error:'ADMIN_TOKEN is not configured'});
  if(req.headers.authorization!==`Bearer ${token}`) return res.status(401).json({error:'unauthorized'});
  next();
}
function cleanPlayers(v){return Array.isArray(v)?v.map(String).map(x=>x.trim()).filter(Boolean).slice(0,5):[]}

app.get('/api/health',(req,res)=>res.json({ok:true,leagueId:Number(process.env.LEAGUE_ID||0),time:new Date().toISOString()}));
app.get('/api/matches',auth,(req,res)=>res.json(read()));
app.get('/api/bot/status',auth,(req,res)=>{
  try{
    const status=JSON.parse(fs.readFileSync(botStatusPath,'utf8'));
    const ageMs=Date.now()-Date.parse(status.updatedAt||0);
    res.json({...status,online:Number.isFinite(ageMs)&&ageMs<20000,ageMs});
  }catch{res.json({online:false,steamOnline:false,gcReady:false,phase:'offline'})}
});

app.post('/api/steam/guard',auth,(req,res)=>{
  const code=String(req.body.code||'').trim();
  if(!/^[A-Za-z0-9]{4,10}$/.test(code)) return res.status(400).json({error:'invalid Steam Guard code format'});
  const tmp=steamGuardPath+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify({code,createdAt:new Date().toISOString()}));
  fs.renameSync(tmp,steamGuardPath);
  res.json({ok:true});
});

app.post('/api/matches',auth,(req,res)=>{
  const rows=read();
  const id=crypto.randomUUID();
  const radiant=cleanPlayers(req.body.radiant),dire=cleanPlayers(req.body.dire);
  const requestedBestOf=Number(req.body.bestOf);
  const bestOf=[1,3,5].includes(requestedBestOf)?requestedBestOf:3;
  const row={
    id,status:'queued',action:null,
    name:String(req.body.name||`Riftline ${id.slice(0,6)}`).slice(0,80),
    password:crypto.randomBytes(4).toString('hex').toUpperCase(),
    radiant,dire,bestOf,
    createdAt:new Date().toISOString()
  };
  rows.push(row);write(rows);res.status(201).json(row);
});

app.post('/api/matches/:id/action',auth,(req,res)=>{
  const allowed=new Set(['launch','destroy','cancel']);
  const action=String(req.body.action||'');
  if(!allowed.has(action)) return res.status(400).json({error:'invalid action'});
  const rows=read(),m=rows.find(x=>x.id===req.params.id);
  if(!m) return res.sendStatus(404);
  m.action=action;m.updatedAt=new Date().toISOString();write(rows);res.json(m);
});

app.post('/api/matches/:id/status',auth,(req,res)=>{
  const rows=read(),m=rows.find(x=>x.id===req.params.id);
  if(!m) return res.sendStatus(404);
  const allowed=['status','lobbyId','error','matchId','action','invitesSent','workerId'];
  for(const k of allowed) if(Object.prototype.hasOwnProperty.call(req.body,k)) m[k]=req.body[k];
  m.updatedAt=new Date().toISOString();write(rows);res.json(m);
});

app.listen(process.env.PORT||3000,()=>console.log(`Riftline API on :${process.env.PORT||3000}`));
