/* Riftline Dota 2 lobby bot.
   The API is the sole owner of match storage; this worker talks to it over HTTP.
   Use a dedicated organizer account. LEAGUE_ID requires legitimate Valve approval. */
require('dotenv').config();
const Steam=require('steam');
const dota2=require('dota2');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {LoginSession,EAuthTokenPlatformType}=require('steam-session');

const steamClient=new Steam.SteamClient();
const steamUser=new Steam.SteamUser(steamClient);
const Dota2=new dota2.Dota2Client(steamClient,true,false);

const api=(process.env.BOT_API_URL||`http://127.0.0.1:${process.env.PORT||3000}`).replace(/\/$/,'');
const token=process.env.ADMIN_TOKEN;
const workerId=process.env.BOT_WORKER_ID||'riftline-1';
const dataDir=process.env.BOT_DATA_DIR||path.join(__dirname,'../data');
const sentryPath=path.join(dataDir,'steam-sentry.bin');
const serversPath=path.join(dataDir,'steam-servers.json');
const refreshTokenPath=path.join(dataDir,'steam-refresh-token.txt');
const machineTokenPath=path.join(dataDir,'steam-machine-token.txt');
const guardCodePath=path.join(dataDir,'steam-guard-code.json');
fs.mkdirSync(dataDir,{recursive:true});
try{
  const saved=JSON.parse(fs.readFileSync(serversPath,'utf8'));
  if(Array.isArray(saved)&&saved.length) Steam.servers=saved;
}catch{}

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
let cmRefreshToken=null;
function logon(){
  const account=process.env.STEAM_USERNAME;
  if(!account||!cmRefreshToken){console.error('Steam account / refresh token missing');return}
  // Steam's modern client flow sends the refresh token in CMsgClientLogon.access_token.
  steamUser.logOn({account_name:account,access_token:cmRefreshToken,should_remember_password:true});
}
async function waitForGuardCode(session){
  console.log('Waiting for Steam Guard code from Riftline Admin');
  const deadline=Date.now()+9*60*1000;
  while(Date.now()<deadline){
    let payload=null;
    try{
      payload=JSON.parse(fs.readFileSync(guardCodePath,'utf8'));
      fs.unlinkSync(guardCodePath);
    }catch{}
    const code=String(payload?.code||'').trim();
    if(code){
      try{
        await session.submitSteamGuardCode(code);
        console.log('Steam Guard code accepted; waiting for authentication');
        return true;
      }catch(e){
        console.error('Steam Guard code rejected',e.message,e.eresult||'');
        console.log('Waiting for another Steam Guard code in the same login session');
      }
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  console.error('Steam Guard code wait timed out');
  return false;
}
async function authenticate(){
  const account=process.env.STEAM_USERNAME,password=process.env.STEAM_PASSWORD;
  if(!account||!password){console.error('STEAM_USERNAME / STEAM_PASSWORD missing');return}
  try{
    const saved=fs.readFileSync(refreshTokenPath,'utf8').trim();
    if(saved){cmRefreshToken=saved;console.log('Using saved Steam refresh token');steamClient.connect();return}
  }catch{}
  try{fs.unlinkSync(guardCodePath)}catch{}
  const session=new LoginSession(EAuthTokenPlatformType.SteamClient);
  session.loginTimeout=600000;
  session.on('steamGuardMachineToken',token=>{
    try{fs.writeFileSync(machineTokenPath,String(token))}catch(e){console.error('Machine token save failed',e.message)}
  });
  session.on('authenticated',()=>{
    try{
      cmRefreshToken=session.refreshToken;
      fs.writeFileSync(refreshTokenPath,cmRefreshToken);
      console.log('Modern Steam authentication completed; refresh token saved');
      steamClient.connect();
    }catch(e){console.error('Steam token save failed',e.message)}
  });
  session.on('timeout',()=>console.error('Modern Steam authentication timed out'));
  session.on('error',e=>console.error('Modern Steam authentication error',e.message,e.eresult||''));
  let machineToken;
  try{machineToken=fs.readFileSync(machineTokenPath,'utf8').trim()||undefined}catch{}
  try{
    const result=await session.startWithCredentials({accountName:account,password,steamGuardMachineToken:machineToken});
    if(result.actionRequired){
      const types=result.validActions.map(x=>x.type);
      console.log('Steam Guard action required:',types.join(','));
      if(types.includes(2)||types.includes(3)){
        await waitForGuardCode(session);
      }else{
        console.log('Approve the Steam login using the requested Steam confirmation method');
      }
    }
  }catch(e){console.error('Modern Steam authentication start failed',e.message,e.eresult||'')}
}

steamClient.on('connected',logon);
steamClient.on('error',e=>{console.error('Steam connection error',e?.message||e);scheduleReconnect()});
steamClient.on('loggedOff',r=>{console.error('Steam logged off',r);scheduleReconnect()});
steamClient.on('servers',servers=>{
  try{fs.writeFileSync(serversPath,JSON.stringify(servers))}catch(e){console.error('Server list save failed',e.message)}
});
steamUser.on('updateMachineAuth',(sentry,callback)=>{
  try{
    const hash=crypto.createHash('sha1').update(sentry.bytes).digest();
    fs.writeFileSync(sentryPath,hash);
    callback({sha_file:hash});
    console.log('Steam machine authorization saved');
  }catch(e){
    console.error('Steam machine authorization save failed',e.message);
    callback({});
  }
});
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

authenticate().catch(e=>console.error('Authentication bootstrap failed',e.message));
