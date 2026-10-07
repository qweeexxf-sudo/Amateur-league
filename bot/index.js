/* Riftline Dota 2 lobby bot.
   The API is the sole owner of match storage; this worker talks to it over HTTP.
   Use a dedicated organizer account. LEAGUE_ID requires legitimate Valve approval. */
require('dotenv').config();
const Steam=require('steam');
const dota2=require('dota2');

const steamClient=new Steam.SteamClient();
const steamUser=new Steam.SteamUser(steamClient);
const Dota2=new dota2.Dota2Client(steamClient,true,false);

const api=(process.env.BOT_API_URL||`http://127.0.0.1:${process.env.PORT||3000}`).replace(/\/$/,'');
const token=process.env.ADMIN_TOKEN;
const workerId=process.env.BOT_WORKER_ID||'riftline-1';

let creating=false;
let activeMatchId=null;
let pumpTimer=null;
let reconnectTimer=null;
let pumping=false;

async function request(path,options={}){
  if(!token) throw new Error('ADMIN_TOKEN missing');
  const r=await fetch(api+path,{
    ...options,
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,...(options.headers||{})}
  });
  const body=await r.text();
  if(!r.ok) throw new Error(`API ${r.status}: ${body}`);
  return body?JSON.parse(body):null;
}
async function rows(){return request('/api/matches')}
async function patch(id,values){
  try{
    return await request('/api/matches/'+encodeURIComponent(id)+'/status',{
      method:'POST',body:JSON.stringify(values)
    });
  }catch(e){console.error('Status update failed',e.message);return null}
}
function scheduleReconnect(){
  if(reconnectTimer)return;
  reconnectTimer=setTimeout(()=>{
    reconnectTimer=null;
    try{steamClient.connect()}catch(e){console.error('Reconnect failed',e.message);scheduleReconnect()}
  },5000);
}
function logon(){
  const account=process.env.STEAM_USERNAME,password=process.env.STEAM_PASSWORD;
  if(!account||!password){console.error('STEAM_USERNAME / STEAM_PASSWORD missing');return}
  steamUser.logOn({account_name:account,password,auth_code:process.env.STEAM_GUARD_CODE||undefined});
}

steamClient.on('connected',logon);
steamClient.on('error',e=>{console.error('Steam connection error',e?.message||e);scheduleReconnect()});
steamClient.on('loggedOff',r=>{console.error('Steam logged off',r);scheduleReconnect()});
steamClient.on('logOnResponse',r=>{
  if(r.eresult===Steam.EResult.OK){console.log('Steam logged in; launching Dota GC');Dota2.launch()}
  else {console.error('Steam login failed',r.eresult);scheduleReconnect()}
});

Dota2.on('ready',()=>{
  console.log('Dota GC ready');
  if(!pumpTimer)pumpTimer=setInterval(()=>pump().catch(e=>console.error('Pump failed',e.message)),1200);
});
Dota2.on('hellotimeout',()=>console.error('Dota GC hello timeout'));

Dota2.on('practiceLobbyUpdate',async lobby=>{
  const id=activeMatchId;
  if(!id)return;
  const lobbyId=lobby?.lobby_id!=null?String(lobby.lobby_id):null;
  const current=await patch(id,{status:'lobby_created',lobbyId,error:null,workerId});
  creating=false;
  if(current&&!current.invitesSent){
    [...(current.radiant||[]),...(current.dire||[])].filter(Boolean).forEach(steamId=>{
      try{Dota2.inviteToLobby(String(steamId))}catch(e){console.error('Invite failed',steamId,e.message)}
    });
    await patch(id,{invitesSent:true});
  }
  console.log('Lobby ready',lobbyId||'(pending id)');
});

Dota2.on('practiceLobbyCleared',async ()=>{
  if(activeMatchId)await patch(activeMatchId,{status:'lobby_closed',action:null});
  activeMatchId=null;creating=false;
});

async function create(match){
  creating=true;activeMatchId=match.id;
  await patch(match.id,{status:'creating_lobby',error:null,workerId});
  const options={
    game_name:match.name,
    pass_key:match.password,
    server_region:Number(process.env.SERVER_REGION||3),
    game_mode:dota2.schema.DOTA_GameMode.DOTA_GAMEMODE_CM,
    allow_cheats:false,fill_with_bots:false,allow_spectating:true,
    series_type:match.bestOf===5?2:1,
    leagueid:Number(process.env.LEAGUE_ID||0)||undefined
  };
  Dota2.createPracticeLobby(options,async err=>{
    if(err){
      console.error('Create lobby failed',err);
      await patch(match.id,{status:'failed',error:String(err)});
      creating=false;activeMatchId=null;
    }
  });
}

async function pump(){
  if(pumping)return;
  pumping=true;
  try{
    const all=await rows();
    const active=activeMatchId?all.find(x=>x.id===activeMatchId):null;
    if(active?.action==='launch'&&Dota2.Lobby){
      await patch(active.id,{action:null,status:'launching'});
      return Dota2.launchPracticeLobby(async err=>{
        if(err)await patch(active.id,{status:'lobby_created',error:String(err)});
        else await patch(active.id,{status:'launched',error:null});
      });
    }
    if(active?.action==='destroy'&&Dota2.Lobby){
      await patch(active.id,{action:null,status:'destroying'});
      return Dota2.destroyLobby(async err=>{
        if(err)await patch(active.id,{status:'lobby_created',error:String(err)});
      });
    }
    if(active?.action==='cancel'){
      await patch(active.id,{action:null,status:'cancelled'});
      if(Dota2.Lobby)return Dota2.destroyLobby(()=>{});
      activeMatchId=null;creating=false;return;
    }
    if(creating||Dota2.Lobby||activeMatchId)return;
    const next=all.find(x=>x.status==='queued');
    if(next)await create(next);
  }finally{pumping=false}
}

function shutdown(){
  if(pumpTimer)clearInterval(pumpTimer);
  try{Dota2.exit()}catch{}
  try{steamClient.disconnect()}catch{}
  process.exit(0);
}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);

steamClient.connect();
