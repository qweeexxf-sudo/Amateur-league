/* Riftline Dota 2 lobby bot prototype.
   Use a dedicated organizer account. This uses community-maintained Steam/Dota GC libraries.
   LEAGUE_ID only works for a legitimately approved league where this account has league-admin rights. */
require('dotenv').config();
const Steam=require('steam');
const dota2=require('dota2');
const fs=require('fs');
const path=require('path');

const steamClient=new Steam.SteamClient();
const steamUser=new Steam.SteamUser(steamClient);
const Dota2=new dota2.Dota2Client(steamClient,true,false);
const db=path.join(__dirname,'../data/matches.json');

let creating=false;
let activeMatchId=null;
let pumpTimer=null;
let reconnectTimer=null;

function read(){try{return JSON.parse(fs.readFileSync(db,'utf8'))}catch{return []}}
function write(rows){const tmp=db+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rows,null,2));fs.renameSync(tmp,db)}
function patch(id,values){
  const rows=read(),m=rows.find(x=>x.id===id);if(!m)return;
  Object.assign(m,values,{updatedAt:new Date().toISOString()});write(rows);
}
function scheduleReconnect(){
  if(reconnectTimer)return;
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;try{steamClient.connect()}catch(e){console.error('Reconnect failed',e.message);scheduleReconnect()}},5000);
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
  if(!pumpTimer)pumpTimer=setInterval(pump,1200);
});

Dota2.on('hellotimeout',()=>console.error('Dota GC hello timeout'));

Dota2.on('practiceLobbyUpdate',lobby=>{
  const id=activeMatchId;
  if(!id)return;
  const lobbyId=lobby?.lobby_id!=null?String(lobby.lobby_id):null;
  patch(id,{status:'lobby_created',lobbyId,error:null});
  creating=false;
  const m=read().find(x=>x.id===id);
  if(m&&!m.invitesSent){
    [...(m.radiant||[]),...(m.dire||[])].filter(Boolean).forEach(steamId=>{
      try{Dota2.inviteToLobby(String(steamId))}catch(e){console.error('Invite failed',steamId,e.message)}
    });
    patch(id,{invitesSent:true});
  }
  console.log('Lobby ready',lobbyId||'(pending id)');
});

Dota2.on('practiceLobbyCleared',()=>{
  if(activeMatchId)patch(activeMatchId,{status:'lobby_closed',action:null});
  activeMatchId=null;creating=false;
});

function create(match){
  creating=true;activeMatchId=match.id;
  patch(match.id,{status:'creating_lobby',error:null});
  const options={
    game_name:match.name,
    pass_key:match.password,
    server_region:Number(process.env.SERVER_REGION||3),
    game_mode:dota2.schema.DOTA_GameMode.DOTA_GAMEMODE_CM,
    allow_cheats:false,fill_with_bots:false,allow_spectating:true,
    series_type:match.bestOf===5?2:1,
    leagueid:Number(process.env.LEAGUE_ID||0)||undefined
  };
  Dota2.createPracticeLobby(options,(err)=>{
    if(err){
      console.error('Create lobby failed',err);
      patch(match.id,{status:'failed',error:String(err)});
      creating=false;activeMatchId=null;
    }
  });
}

function pump(){
  const rows=read();
  const active=activeMatchId?rows.find(x=>x.id===activeMatchId):null;
  if(active?.action==='launch'&&Dota2.Lobby){
    patch(active.id,{action:null,status:'launching'});
    return Dota2.launchPracticeLobby(err=>{
      if(err)patch(active.id,{status:'lobby_created',error:String(err)});
      else patch(active.id,{status:'launched',error:null});
    });
  }
  if(active?.action==='destroy'&&Dota2.Lobby){
    patch(active.id,{action:null,status:'destroying'});
    return Dota2.destroyLobby(err=>{
      if(err)patch(active.id,{status:'lobby_created',error:String(err)});
    });
  }
  if(active?.action==='cancel'){
    patch(active.id,{action:null,status:'cancelled'});
    if(Dota2.Lobby)return Dota2.destroyLobby(()=>{});
    activeMatchId=null;creating=false;return;
  }
  if(creating||Dota2.Lobby||activeMatchId)return;
  const next=rows.find(x=>x.status==='queued');
  if(next)create(next);
}

process.on('SIGINT',()=>{
  if(pumpTimer)clearInterval(pumpTimer);
  try{Dota2.exit()}catch{}
  try{steamClient.disconnect()}catch{}
  process.exit(0);
});

steamClient.connect();
