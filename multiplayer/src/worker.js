// Public, informal leaderboard. Scores come from player browsers and are
// NOT yet server-verified. Do not use this for prizes or competitive rankings.
// Only the submitted display name, manually selected country flag, Boo Crew
// character, ghost color, score and server-created date are stored.
// No email, authentication tokens, geolocation, or IP data is saved.
const COUNTRY_CODES=new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
const GHOST_COLORS=new Set(["#D98A91","#E8AD87","#F2DF9D","#B8DDC4","#A7D3EA","#C9B9E5","#F1B4D5"]);
const ALLOWED_GAME_ORIGINS=/^https:\/\/magicalboyco\.github\.io$|^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
const HIGH_SCORE_KEY='top13-v1';
const leaderboardCors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'
};
const boardReply=(body,status=200)=>Response.json(body,{status,headers:leaderboardCors});
const validNickname=name=>typeof name==='string'&&
  name===name.trim()&&name.length>=1&&name.length<=13&&
  /^[\p{L}\p{M}\p{N} ._'-]+$/u.test(name)&&/[\p{L}\p{N}]/u.test(name);

// Alpha 14 multiplayer relay. The match host runs Alpha 13 physics; other
// players provide only movement inputs. This is a prototype, NOT an
// anti-cheat authoritative simulation. Upgrade to server-side physics later.
const CLASSIC_SEATS=[0,4,1,5,2,6,3,7];
const COOP_SEATS=[0,1,2,3];
const FOURWAY_SEATS=[0,2,4,6,1,3,5,7];
const ROOM_MODES=new Set(['classic','coop','fourway']);
const validMode=value=>ROOM_MODES.has(value)?value:'classic';
const ok = (value) => JSON.stringify(value);
const validCode = (code) => /^[A-Z2-9]{6}$/.test(code);
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_LIFETIME_MS=60*60*1000;
const REMATCH_VOTE_MS=10000;
const roomHeaders={
  ...leaderboardCors,
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type'
};
const roomReply=(body,status=200)=>Response.json(body,{status,headers:roomHeaders});
const secureRandom=(length,alphabet=CODE_ALPHABET)=>{
  const bytes=new Uint8Array(length);crypto.getRandomValues(bytes);
  return [...bytes].map(n=>alphabet[n%alphabet.length]).join('');
};
const tokenHash=async token=>{
  const bytes=new TextEncoder().encode(token);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Health checks are requested directly by GitHub Pages, so they need
    // the same cross-origin response headers as room creation.
    if (url.pathname === "/health") return Response.json(
      {ok:true,service:"ghost-duel-alpha34",modes:['classic','coop','fourway'],rematchVoting:true},
      {headers:roomHeaders}
    );
    if (url.pathname === '/rooms' && request.method==='OPTIONS')
      return new Response(null,{status:204,headers:roomHeaders});
    if (url.pathname === '/rooms' && request.method==='POST') {
      const origin=request.headers.get('Origin');
      if(origin&&!ALLOWED_GAME_ORIGINS.test(origin))
        return roomReply({error:'Origin not allowed'},403);
      // The server creates a room before either client can join it.
      // The host secret is never put in an invite link or stored in the browser.
      const roomBody=await request.json().catch(()=>({}));
      const mode=validMode(roomBody?.mode);
      for(let attempt=0;attempt<5;attempt++){
        const code=secureRandom(6),token=secureRandom(48);
        const id=env.GHOST_ROOMS.idFromName('room-'+code);
        const result=await env.GHOST_ROOMS.get(id).fetch(
          new Request('https://room.internal/reserve',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({hash:await tokenHash(token),mode})
          })
        );
        if(result.status===409)continue;
        if(!result.ok)return roomReply({error:'Could not reserve a room'},503);
        return roomReply({code,mode,hostToken:token,expiresInSeconds:ROOM_LIFETIME_MS/1000},201);
      }
      return roomReply({error:'Could not create a unique room. Try again.'},503);
    }
    const roomStatus=/^\/rooms\/([A-Z2-9]{6})$/i.exec(url.pathname);
    if(roomStatus&&request.method==='GET'){
      const code=roomStatus[1].toUpperCase();
      const id=env.GHOST_ROOMS.idFromName('room-'+code);
      return env.GHOST_ROOMS.get(id).fetch(
        new Request('https://room.internal/status')
      );
    }
    if (url.pathname === "/leaderboard") {
      if(request.method==='OPTIONS')
        return new Response(null,{status:204,headers:leaderboardCors});
      const origin=request.headers.get('Origin');
      if(request.method==='POST'&&origin&&!ALLOWED_GAME_ORIGINS.test(origin))
        return boardReply({error:'Submission origin not allowed'},403);
      const id=env.GHOST_ROOMS.idFromName('global-hall-of-fame-v1');
      return env.GHOST_ROOMS.get(id).fetch(request);
    }
    const match = /^\/room\/([A-Z2-9]{6})$/i.exec(url.pathname);
    if (!match || !validCode(match[1].toUpperCase())) return new Response("Not found", {status:404});
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", {status:426});
    const id = env.GHOST_ROOMS.idFromName('room-'+match[1].toUpperCase());
    return env.GHOST_ROOMS.get(id).fetch(request);
  }
};

export class GhostRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.host = null;
    this.started = false;
    this.lastSnapshot = 0;
    this.roomMeta=null;
    this.preparing=false;
    this.roundId=null;
    this.readySeats=new Set();
    this.profiles=new Map();
    this.mode='classic';
    this.rematch=null; // vote window: invitation id, deadline, affirmative seats
    this.rematchApproved=false;
    // Connection state is rehydrated from attachment metadata after hibernation.
    this.rebuild();
  }
  rebuild() {
    const sockets = this.state.getWebSockets();
    this.players = new Map();
    for (const ws of sockets) {
      const info = ws.deserializeAttachment();
      if (info && Number.isInteger(info.seat)) this.players.set(info.seat, ws);
    }
    this.host = this.players.has(0) ? this.players.get(0) : null;
    // Active matches are not resumed after hibernation; hibernation should
    // normally not occur during regular snapshots.
    this.started = sockets.some(ws => ws.deserializeAttachment()?.started === true);
    this.preparing = sockets.some(ws => ws.deserializeAttachment()?.preparing === true);
    this.roundId = sockets.map(ws=>ws.deserializeAttachment()?.roundId).find(Boolean)||null;
    this.readySeats=new Set(sockets.filter(ws=>ws.deserializeAttachment()?.ready===true)
      .map(ws=>ws.deserializeAttachment()?.seat).filter(Number.isInteger));
    this.profiles=new Map(sockets.map(ws=>ws.deserializeAttachment())
      .filter(info=>info&&Number.isInteger(info.seat)&&info.profile)
      .map(info=>[info.seat,info.profile]));
    this.mode=validMode(sockets.map(ws=>ws.deserializeAttachment()?.mode)
      .find(value=>ROOM_MODES.has(value)));
    // The vote state is mirrored in Durable Object storage and rehydrated
    // on demand so a hibernating Worker cannot force a rematch.
    // Recover room mode, player profiles and readiness after hibernation.
  }
  send(ws, data) { try { ws.send(ok(data)); } catch {} }
  broadcast(data) { for (const ws of this.players.values()) this.send(ws, data); }
  roster() {
    this.broadcast({
      type:'roster',
      seats:[...this.players.keys()].sort((a,b)=>a-b),
      profiles:[...this.profiles].map(([seat,profile])=>({seat,...profile})),
      started:this.started,preparing:this.preparing,mode:this.mode
    });
  }
  async currentRematch(){
    if(this.rematch===null)this.rematch=await this.state.storage.get('rematch-vote')||null;
    return this.rematch;
  }
  async clearRematch(reason='cancelled'){
    const vote=await this.currentRematch();
    if(!vote)return;
    this.rematch=null;
    await this.state.storage.delete('rematch-vote');
    this.broadcast({type:'rematchCancelled',id:vote.id,reason});
  }
  async voteStatus(){
    const vote=await this.currentRematch();
    if(!vote)return;
    const seats=[...this.players.keys()].sort((a,b)=>a-b);
    this.broadcast({type:'rematchStatus',id:vote.id,deadline:vote.deadline,
      yesSeats:vote.yesSeats.filter(seat=>seats.includes(seat)),seats});
  }
  async alarm(){
    const vote=await this.currentRematch();
    if(vote&&Date.now()>=vote.deadline)await this.clearRematch('timeout');
  }
  sanitizeProfile(message){
    // User-chosen display names are shared only inside their private room.
    // Keep them short and printable; browsers render them with textContent or
    // canvas fillText, never innerHTML. A blank name remains optional.
    const raw=typeof message?.name==='string'?message.name.trim():'';
    const name=raw.length<=16&&/^[\p{L}\p{M}\p{N} ._'-]*$/u.test(raw)&&
      (!raw||/[\p{L}\p{N}]/u.test(raw))?raw:'';
    return {
      styleId:Number.isInteger(message?.styleId)&&message.styleId>=0&&message.styleId<8?message.styleId:0,
      color:GHOST_COLORS.has(message?.color)?message.color:'#C9B9E5',
      name
    };
  }
  beginRound(){
    if(!this.started||!this.preparing)return;
    this.preparing=false;
    this.readySeats.clear();
    for(const socket of this.players.values()){
      const data=socket.deserializeAttachment();
      socket.serializeAttachment({...data,preparing:false,ready:false});
    }
    // The server declares the round started only once ALL seated browsers
    // have confirmed receiving the prepare message.
    const now=Date.now();
    this.broadcast({type:'start',roundId:this.roundId,seats:[...this.players.keys()],
      mode:this.mode,serverTime:now,launchAt:this.rematchApproved?now+3000:null});
    this.rematchApproved=false;
  }
  async leaderboardRequest(request) {
    if(request.method!=='GET'&&request.method!=='POST')
      return boardReply({error:'Method not allowed'},405);
    // A separate key within the existing SQLite-backed GhostRoom namespace;
    // no new Durable Object class or migration is necessary.
    let top=await this.state.storage.get(HIGH_SCORE_KEY);
    if(!Array.isArray(top))top=[];
    if(request.method==='GET')return boardReply({scores:top.slice(0,13),unverified:true});
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))
      return boardReply({error:'Expected application/json'},415);
    const length=Number(request.headers.get('Content-Length')||0);
    if(length>2000)return boardReply({error:'Submission too large'},413);
    let raw;try{raw=await request.text()}catch{return boardReply({error:'Cannot read submission'},400)}
    if(raw.length>1500)return boardReply({error:'Submission too large'},413);
    let entry;try{entry=JSON.parse(raw)}catch{return boardReply({error:'Invalid JSON'},400)}
    if(!entry||typeof entry!=='object')return boardReply({error:'Invalid submission'},400);
    const {name,country,styleId,color,score}=entry;
    if(!validNickname(name)||!COUNTRY_CODES.has(country)||
       !Number.isInteger(styleId)||styleId<0||styleId>7||
       !GHOST_COLORS.has(color)||!Number.isInteger(score)||score<1||score>99999)
      return boardReply({error:'Check name (1–13 characters), country, character and score'},400);
    const candidate={
      id:crypto.randomUUID(),name,country,styleId,color,score,
      createdAt:new Date().toISOString()
    };
    const ordered=[...top,candidate].sort((a,b)=>
      b.score-a.score||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    top=ordered.slice(0,13);
    const rank=top.findIndex(item=>item.id===candidate.id)+1;
    if(rank>0)await this.state.storage.put(HIGH_SCORE_KEY,top);
    return boardReply({accepted:rank>0,rank:rank||null,scores:top,unverified:true});
  }

  async getRoomMeta(){
    // Cached only after the first storage read; every creation is serialized
    // by the Durable Object's single-threaded storage operations.
    if(this.roomMeta===null)this.roomMeta=await this.state.storage.get('room-meta')||null;
    this.mode=validMode(this.roomMeta?.mode);
    return this.roomMeta;
  }
  async fetch(request) {
    const path=new URL(request.url).pathname;
    if(path==='/leaderboard')return this.leaderboardRequest(request);
    if(path==='/reserve'&&request.method==='POST'){
      const previous=await this.getRoomMeta();
      if(previous&&previous.expiresAt>Date.now())return roomReply({error:'Room already exists'},409);
      if(this.players.size>0)return roomReply({error:'Room is occupied'},409);
      const body=await request.json().catch(()=>null);
      if(!body||!(/^[a-f0-9]{64}$/.test(body.hash)))return roomReply({error:'Invalid reservation'},400);
      this.roomMeta={hash:body.hash,mode:validMode(body.mode),createdAt:Date.now(),expiresAt:Date.now()+ROOM_LIFETIME_MS};
      this.mode=this.roomMeta.mode;
      await this.state.storage.put('room-meta',this.roomMeta);
      this.started=false;
      return roomReply({reserved:true,mode:this.mode},201);
    }
    const meta=await this.getRoomMeta();
    if(!meta||(!this.players.size&&meta.expiresAt<Date.now()))
      return roomReply({error:'Room not found or expired'},404);
    if(path==='/status'&&request.method==='GET')
      return roomReply({exists:true,started:this.started,preparing:this.preparing,players:this.players.size,mode:this.mode,maxPlayers:this.mode==='coop'?4:8});
    if(this.started)return new Response('Match already started',{status:409});
    // Verify status before opening the WebSocket. Seat allocation occurs
    // ONLY after the client explicitly authenticates its host or guest role.
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')
      return new Response('WebSocket required',{status:426});
    if(this.players.size>=(this.mode==='coop'?4:8))return new Response('Room full',{status:409});
    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({seat:null,started:false});
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(ws, raw) {
    const meta=ws.deserializeAttachment();
    if(!meta||typeof raw!=='string'||raw.length>200000)return;
    let msg;try{msg=JSON.parse(raw)}catch{return}
    if(!msg||typeof msg.type!=='string')return;
    if(meta.seat===null){
      if(msg.type!=='hello'){
        this.send(ws,{type:'error',reason:'Room handshake required'});
        try{ws.close(1008,'Handshake required')}catch{}
        return;
      }
      const room=await this.getRoomMeta();
      if(!room)return this.send(ws,{type:'error',reason:'Room no longer exists'});
      let seat;
      if(msg.role==='host'){
        if(typeof msg.token!=='string'||msg.token.length!==48
           ||await tokenHash(msg.token)!==room.hash||this.players.has(0)){
          this.send(ws,{type:'error',reason:'Host authentication failed'});
          try{ws.close(1008,'Not authorized')}catch{}
          return;
        }
        seat=0;
      }else if(msg.role==='guest'){
        const seatOrder=this.mode==='coop'?COOP_SEATS:this.mode==='fourway'?FOURWAY_SEATS:CLASSIC_SEATS;
        seat=seatOrder.find(s=>s!==0&&!this.players.has(s));
        if(seat===undefined){
          this.send(ws,{type:'error',reason:'Room is full'});
          try{ws.close(1008,'Room full')}catch{}
          return;
        }
      }else{
        this.send(ws,{type:'error',reason:'Invalid room role'});
        try{ws.close(1008,'Invalid role')}catch{}
        return;
      }
      const profile=this.sanitizeProfile(msg);
      ws.serializeAttachment({seat,started:false,profile,mode:this.mode});
      this.players.set(seat,ws);
      this.profiles.set(seat,profile);
      if(seat===0)this.host=ws;
      this.send(ws,{type:'welcome',seat,host:seat===0,mode:this.mode});
      this.roster();
      return;
    }
    if(msg.type==='profile'&&!this.started){
      const profile=this.sanitizeProfile(msg);
      this.profiles.set(meta.seat,profile);
      ws.serializeAttachment({...meta,profile});
      this.roster();
      return;
    }
    // Host invites; every connected human (including the host) must
    // explicitly vote YES. Silence counts as NO after ten seconds.
    // No single user can force other devices into another game.
    if(msg.type==='rematchInvite'){
      if(meta.seat!==0||this.started||this.preparing)return;
      if(await this.currentRematch())return;
      const vote={id:crypto.randomUUID(),deadline:Date.now()+REMATCH_VOTE_MS,yesSeats:[]};
      this.rematch=vote;
      await this.state.storage.put('rematch-vote',vote);
      if(typeof this.state.storage.setAlarm==='function')
        await this.state.storage.setAlarm(vote.deadline);
      this.broadcast({type:'rematchInvite',id:vote.id,deadline:vote.deadline,
        seats:[...this.players.keys()]});
      await this.voteStatus();
      return;
    }
    if(msg.type==='rematchVote'){
      if(this.started||this.preparing)return;
      const vote=await this.currentRematch();
      if(!vote||msg.id!==vote.id)return;
      if(Date.now()>=vote.deadline){await this.clearRematch('timeout');return}
      if(msg.accept!==true&&msg.accept!==false)return;
      if(msg.accept===false){await this.clearRematch('declined');return}
      if(!vote.yesSeats.includes(meta.seat))vote.yesSeats.push(meta.seat);
      await this.state.storage.put('rematch-vote',vote);
      const seats=[...this.players.keys()];
      if(seats.length&&seats.every(seat=>vote.yesSeats.includes(seat))){
        this.rematch=null;
        await this.state.storage.delete('rematch-vote');
        this.rematchApproved=true;
        this.broadcast({type:'rematchAccepted',id:vote.id,readySeats:seats});
        // Existing ready/prepare handshake stays authoritative. The host
        // starts the new round only after unanimous explicit consent.
      }else await this.voteStatus();
      return;
    }
    if(msg.type==='start'&&meta.seat===0&&!this.started) {
      // Ordinary host starts are valid when no rematch vote is active.
      if(await this.currentRematch())return;
      this.started=true;
      this.preparing=true;
      this.roundId=crypto.randomUUID();
      this.readySeats.clear();
      for(const socket of this.players.values()){
        const data=socket.deserializeAttachment();
        socket.serializeAttachment({...data,started:true,preparing:true,ready:false,roundId:this.roundId});
      }
      this.broadcast({type:'prepare',roundId:this.roundId,seats:[...this.players.keys()],mode:this.mode,
        profiles:[...this.profiles].map(([seat,profile])=>({seat,...profile}))});
      return;
    }
    if(msg.type==='ready'&&this.started&&this.preparing&&
       msg.roundId===this.roundId&&this.players.get(meta.seat)===ws){
      this.readySeats.add(meta.seat);
      ws.serializeAttachment({...meta,ready:true});
      const seats=[...this.players.keys()];
      this.broadcast({type:'readyStatus',roundId:this.roundId,readySeats:[...this.readySeats],seats});
      if(seats.every(seat=>this.readySeats.has(seat)))this.beginRound();
      return;
    }
    if(!this.started||this.preparing)return;
    if(msg.type==='input'&&meta.seat!==0&&this.players.get(meta.seat)===ws){
      const x=Number(msg.x),y=Number(msg.y),seq=msg.seq;
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isSafeInteger(seq)||seq<0||seq>1e9)return;
      // Connected human controls go to the authoritative host. The host
      // will NEVER substitute bot AI for a seat that is still connected.
      if(this.host)this.send(this.host,{
        type:'input',seat:meta.seat,seq,x:Math.max(-1,Math.min(1,x)),y:Math.max(-1,Math.min(1,y))
      });
      return;
    }
    if(msg.type==='controlAck'&&meta.seat===0){
      if(!Number.isInteger(msg.seat)||!Number.isSafeInteger(msg.seq))return;
      const target=this.players.get(msg.seat);
      if(target&&msg.seat!==0)this.send(target,{type:'controlAck',seq:msg.seq});
      return;
    }
    if (msg.type === "snapshot" && meta.seat === 0) {
      // Relay only; host is trusted in this first prototype.
      const now=Date.now();
      if (now-this.lastSnapshot<40) return;
      this.lastSnapshot=now;
      if (!msg.state || typeof msg.state !== "object") return;
      for (const [seat,socket] of this.players) if (seat!==0) this.send(socket,{type:"snapshot",state:msg.state});
    }
    if (msg.type === "finish" && meta.seat === 0) {
      await this.clearRematch('round finished');
      this.rematchApproved=false;
      this.broadcast({type:"finish"});
      this.started=false;
      this.preparing=false;
      this.readySeats.clear();
      this.roundId=null;
      for(const socket of this.players.values()){
        const data=socket.deserializeAttachment();
        socket.serializeAttachment({...data,started:false,preparing:false,ready:false,roundId:null});
      }
      this.roster();
    }
  }
  webSocketClose(ws) { return this.remove(ws); }
  webSocketError(ws) { return this.remove(ws); }
  async remove(ws) {
    const meta=ws.deserializeAttachment();
    if (!meta || this.players.get(meta.seat)!==ws) return;
    await this.clearRematch('player left');
    this.rematchApproved=false;
    this.players.delete(meta.seat);
    this.profiles.delete(meta.seat);
    if(meta.seat===0) {
      this.roomMeta=null;
      this.state.storage.delete('room-meta').catch(()=>{});
      this.broadcast({type:"closed",reason:"Host disconnected. Create or join a new room."});
      for (const socket of this.players.values()) try{ socket.close(1012,"Host disconnected"); }catch{}
      this.players.clear();this.host=null;this.started=false;
      this.preparing=false;this.roundId=null;this.readySeats.clear();
      this.profiles.clear();
    } else {
      this.readySeats.delete(meta.seat);
      this.broadcast({type:"leave",seat:meta.seat});
      this.roster();
      if(this.preparing&&[...this.players.keys()].every(seat=>this.readySeats.has(seat)))
        this.beginRound();
    }
  }
}
