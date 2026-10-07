require('dotenv').config();
const express=require('express');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const app=express();
app.use(express.json({limit:'32kb'}));
app.use(express.static(path.join(__dirname,'../public')));

const db=path.join(__dirname,'../data/matches.json');
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

app.post('/api/matches',auth,(req,res)=>{
  const rows=read();
  const id=crypto.randomUUID();
  const radiant=cleanPlayers(req.body.radiant),dire=cleanPlayers(req.body.dire);
  const bestOf=Number(req.body.bestOf)===5?5:3;
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
  const allowed=['status','lobbyId','error','matchId','action'];
  for(const k of allowed) if(Object.prototype.hasOwnProperty.call(req.body,k)) m[k]=req.body[k];
  m.updatedAt=new Date().toISOString();write(rows);res.json(m);
});

app.listen(process.env.PORT||3000,()=>console.log(`Riftline API on :${process.env.PORT||3000}`));
