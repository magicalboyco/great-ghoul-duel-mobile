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
const seats = [0,4,1,5,2,6,3,7];
const ok = (value) => JSON.stringify(value);
const validCode = (code) => /^[A-Z2-9]{6}$/.test(code);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ok:true,service:"ghost-duel-alpha18"});
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
    const id = env.GHOST_ROOMS.idFromName(match[1].toUpperCase());
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
  }
  send(ws, data) { try { ws.send(ok(data)); } catch {} }
  broadcast(data) { for (const ws of this.players.values()) this.send(ws, data); }
  roster() {
    this.broadcast({type:"roster",seats:[...this.players.keys()].sort((a,b)=>a-b),started:this.started});
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

  async fetch(request) {
    if (new URL(request.url).pathname==='/leaderboard')
      return this.leaderboardRequest(request);
    if (this.started) return new Response("Match already started", {status:409});
    const seat = seats.find(n => !this.players.has(n));
    if (seat === undefined) return new Response("Room full", {status:409});
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({seat,started:false});
    this.players.set(seat, server);
    if (seat === 0) this.host = server;
    this.send(server,{type:"welcome",seat,host:seat===0});
    this.roster();
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws, raw) {
    const meta = ws.deserializeAttachment();
    if (!meta || typeof raw !== "string" || raw.length > 200000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "start" && meta.seat === 0 && !this.started) {
      this.started = true;
      for (const socket of this.players.values()) {
        const data=socket.deserializeAttachment();
        socket.serializeAttachment({...data,started:true});
      }
      this.broadcast({type:"start",seats:[...this.players.keys()]});
      return;
    }
    if (!this.started) return;
    if (msg.type === "input" && meta.seat !== 0) {
      const x=Number(msg.x),y=Number(msg.y);
      if (!Number.isFinite(x)||!Number.isFinite(y)) return;
      this.send(this.host,{type:"input",seat:meta.seat,x:Math.max(-1,Math.min(1,x)),y:Math.max(-1,Math.min(1,y))});
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
      this.broadcast({type:"finish"});
      this.started = false;
      for(const socket of this.players.values()){
        const data=socket.deserializeAttachment();
        socket.serializeAttachment({...data,started:false});
      }
      this.roster();
    }
  }
  webSocketClose(ws) { this.remove(ws); }
  webSocketError(ws) { this.remove(ws); }
  remove(ws) {
    const meta=ws.deserializeAttachment();
    if (!meta || this.players.get(meta.seat)!==ws) return;
    this.players.delete(meta.seat);
    if(meta.seat===0) {
      this.broadcast({type:"closed",reason:"Host disconnected. Create or join a new room."});
      for (const socket of this.players.values()) try{ socket.close(1012,"Host disconnected"); }catch{}
      this.players.clear();this.host=null;this.started=false;
    } else {
      this.broadcast({type:"leave",seat:meta.seat});
      this.roster();
    }
  }
}
