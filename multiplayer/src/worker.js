// Alpha 14 multiplayer relay. The match host runs Alpha 13 physics; other
// players provide only movement inputs. This is a prototype, NOT an
// anti-cheat authoritative simulation. Upgrade to server-side physics later.
const seats = [0,4,1,5,2,6,3,7];
const ok = (value) => JSON.stringify(value);
const validCode = (code) => /^[A-Z2-9]{6}$/.test(code);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ok:true,service:"ghost-duel-alpha14"});
    const match = /^\/room\/([A-Z2-9]{6})$/.exec(url.pathname.toUpperCase());
    if (!match || !validCode(match[1])) return new Response("Not found", {status:404});
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", {status:426});
    const id = env.GHOST_ROOMS.idFromName(match[1]);
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
  async fetch(request) {
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
