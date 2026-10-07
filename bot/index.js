/* Riftline Lobby Bot prototype.
   Uses the community node-dota2/node-steam stack. Test only on a dedicated Steam account.
   Valve approval is not bypassed: LEAGUE_ID must be an approved league and this bot account must be a league admin. */
require('dotenv').config(); const Steam=require('steam'); const dota2=require('dota2'); const fs=require('fs'); const path=require('path');
const steamClient=new Steam.SteamClient(); const steamUser=new Steam.SteamUser(steamClient); const Dota2=new dota2.Dota2Client(steamClient,true,false);
const db=path.join(__dirname,'../data/matches.json'); let busy=false;
function logon(){steamUser.logOn({account_name:process.env.STEAM_USERNAME,password:process.env.STEAM_PASSWORD,auth_code:process.env.STEAM_GUARD_CODE||undefined});}
steamClient.on('connected',logon);
steamClient.on('logOnResponse',r=>{ if(r.eresult===Steam.EResult.OK){console.log('Steam logged in; launching Dota GC');Dota2.launch();} else console.error('Steam login failed',r.eresult); });
Dota2.on('ready',()=>{console.log('Dota GC ready'); setInterval(pump,1200);});
Dota2.on('practiceLobbyUpdate',l=>console.log('Lobby update',String(l.lobby_id||''),l.members?.length||0));
function pump(){if(busy||Dota2.Lobby)return; const rows=JSON.parse(fs.readFileSync(db,'utf8')); const match=rows.find(x=>x.status==='queued'); if(!match)return; busy=true;
 const options={game_name:match.name,pass_key:match.password,server_region:Number(process.env.SERVER_REGION||3),game_mode:dota2.schema.DOTA_GameMode.DOTA_GAMEMODE_CM,allow_cheats:false,fill_with_bots:false,allow_spectating:true,series_type:match.bestOf===5?2:1,leagueid:Number(process.env.LEAGUE_ID||0)||undefined};
 Dota2.createPracticeLobby(options,(err)=>{busy=false;if(err){console.error('create lobby failed',err);return;} match.status='lobby_created'; match.lobbyId=Dota2.Lobby?String(Dota2.Lobby.lobby_id):null; match.updatedAt=new Date().toISOString();fs.writeFileSync(db,JSON.stringify(rows,null,2)); console.log('Lobby created',match.name,match.password); [...match.radiant,...match.dire].filter(Boolean).forEach(id=>Dota2.inviteToLobby(String(id))); });
}
process.on('SIGINT',()=>{try{Dota2.exit()}catch{};steamClient.disconnect();process.exit(0)}); steamClient.connect();
