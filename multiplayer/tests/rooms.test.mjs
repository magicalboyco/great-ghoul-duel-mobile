import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const workerSource=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const source=workerSource
  .replace('export default','const workerDefault=')
  .replace('export class GhostRoom','class GhostRoom');

class Socket {
  constructor(){this.sent=[];this.info=null;this.closed=false}
  send(value){this.sent.push(JSON.parse(value))}
  deserializeAttachment(){return this.info}
  serializeAttachment(value){this.info=value}
  close(){this.closed=true}
}
class Pair {constructor(){this[0]=new Socket();this[1]=new Socket()}}
class Reply {
  constructor(body='',opts={}){this.body=body;this.status=opts.status??200;this.ok=this.status>=200&&this.status<300;this.webSocket=opts.webSocket}
  static json(value,opts){return new Reply(JSON.stringify(value),opts)}
  async json(){return JSON.parse(this.body)}
}
class InternalRequest {
  constructor(url,init={}){this.url=url;this.method=init.method??'GET';this.body=init.body;this.headers={get:key=>init.headers?.[key]??null}}
  async json(){return JSON.parse(this.body)}
}
const runtime=new Function('Response','Request','WebSocketPair','crypto','TextEncoder','URL',
  source+';return {workerDefault,GhostRoom}')(
    Reply,InternalRequest,Pair,webcrypto,TextEncoder,URL
  );

function mockRequest(url,method='GET',headers={},payload=null){
  return {url,method,headers:{get:key=>headers[key]??null},text:async()=>JSON.stringify(payload)};
}
function harness(){
  const instances=new Map();
  const env={GHOST_ROOMS:{
    idFromName:value=>value,
    get:id=>{
      if(!instances.has(id)){
        const sockets=[],storage=new Map();
        const state={
          getWebSockets:()=>sockets.filter(socket=>!socket.closed),
          acceptWebSocket:socket=>sockets.push(socket),
          storage:{
            get:async key=>storage.get(key),
            put:async(key,value)=>storage.set(key,value),
            delete:async key=>storage.delete(key)
          }
        };
        instances.set(id,{room:new runtime.GhostRoom(state,{}),sockets});
      }
      return {fetch:request=>instances.get(id).room.fetch(request)};
    }
  }};
  return {env,instances};
}

test('room creation requires a real reservation, host secret and join authorization',async()=>{
  const {env,instances}=harness();
  const created=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/rooms','POST',{Origin:'https://magicalboyco.github.io'}),env);
  assert.equal(created.status,201);
  const {code,hostToken}=await created.json();
  assert.match(code,/^[A-Z2-9]{6}$/);
  assert.equal(hostToken.length,48);
  const roomId='room-'+code;
  assert.equal((await runtime.workerDefault.fetch(mockRequest('https://example.test/rooms/ZZZZZZ'),env)).status,404);
  assert.equal((await runtime.workerDefault.fetch(mockRequest('https://example.test/rooms/'+code),env)).status,200);
  const instance=instances.get(roomId);
  async function enter(){
    const result=await runtime.workerDefault.fetch(mockRequest(
      'https://example.test/room/'+code,'GET',{Upgrade:'websocket'}),env);
    assert.equal(result.status,101);
    return instance.sockets.at(-1);
  }
  const guest=await enter();
  await instance.room.webSocketMessage(guest,JSON.stringify({
    type:'hello',role:'guest',styleId:5,color:'#C9B9E5'
  }));
  assert.ok(guest.sent.some(message=>message.type==='welcome'&&message.seat!==0));
  const guestSeat=guest.deserializeAttachment().seat;
  assert.ok(guest.sent.some(message=>message.type==='roster'&&message.profiles
    .some(profile=>profile.seat===guestSeat&&profile.styleId===5&&profile.color==='#C9B9E5')),
    'Guest Boo Crew character and color are broadcast to the lobby');

  const wrongHost=await enter();
  await instance.room.webSocketMessage(wrongHost,JSON.stringify({type:'hello',role:'host',token:'x'.repeat(48)}));
  assert.equal(wrongHost.closed,true);
  assert.ok(wrongHost.sent.some(message=>message.type==='error'));

  const host=await enter();
  await instance.room.webSocketMessage(host,JSON.stringify({
    type:'hello',role:'host',token:hostToken,styleId:6,color:'#F2DF9D'
  }));
  assert.ok(host.sent.some(message=>message.type==='welcome'&&message.seat===0&&message.host===true));
  assert.equal(instance.room.players.size,2);
  assert.ok(guest.sent.some(message=>message.type==='roster'&&message.seats.length===2));

  await instance.room.webSocketMessage(guest,JSON.stringify({type:'start'}));
  assert.equal(instance.room.started,false);
  await instance.room.webSocketMessage(host,JSON.stringify({type:'start'}));
  assert.equal(instance.room.started,true);
  assert.equal(instance.room.preparing,true);
  const hostPrepare=host.sent.find(message=>message.type==='prepare');
  const guestPrepare=guest.sent.find(message=>message.type==='prepare');
  assert.ok(hostPrepare,'Host receives the prepare event');
  assert.ok(guestPrepare,'Guest receives the prepare event');
  assert.equal(hostPrepare.roundId,guestPrepare.roundId,'Both devices prepare the same round');
  assert.equal(host.sent.some(message=>message.type==='start'),false,'The host cannot start alone');
  assert.equal(guest.sent.some(message=>message.type==='start'),false,'The guest is not skipped');
  await instance.room.webSocketMessage(host,JSON.stringify({type:'ready',roundId:hostPrepare.roundId}));
  assert.equal(instance.room.preparing,true,'Waiting for the guest to acknowledge');
  assert.equal(host.sent.some(message=>message.type==='start'),false);
  await instance.room.webSocketMessage(guest,JSON.stringify({type:'ready',roundId:'wrong-round'}));
  assert.equal(instance.room.preparing,true,'Wrong round acknowledgments are ignored');
  await instance.room.webSocketMessage(guest,JSON.stringify({type:'ready',roundId:guestPrepare.roundId}));
  assert.equal(instance.room.preparing,false,'Both devices have acknowledged');
  const hostStart=host.sent.find(message=>message.type==='start');
  const guestStart=guest.sent.find(message=>message.type==='start');
  assert.ok(hostStart&&guestStart,'Start is delivered to both connected browsers');
  assert.equal(hostStart.roundId,guestStart.roundId,'The same round begins everywhere');

  await instance.room.webSocketMessage(guest,JSON.stringify({
    type:'input',seq:1,x:.7,y:.2
  }));
  assert.ok(host.sent.some(message=>message.type==='input'&&message.seat===guestSeat&&
    message.seq===1&&message.x===.7&&message.y===.2),
    'Guest joystick movement reaches host physics, rather than running a bot');
  await instance.room.webSocketMessage(host,JSON.stringify({
    type:'controlAck',seat:guestSeat,seq:1
  }));
  assert.ok(guest.sent.some(message=>message.type==='controlAck'&&message.seq===1),
    'Guest receives confirmation that the host processed joystick input');
  await instance.room.webSocketMessage(guest,JSON.stringify({
    type:'profile',styleId:7,color:'#A7D3EA'
  }));
  assert.equal(instance.room.profiles.get(guestSeat).styleId,5,
    'Live match profiles do not change after starting');

  instance.room.webSocketClose(host);
  assert.equal((await runtime.workerDefault.fetch(mockRequest('https://example.test/rooms/'+code),env)).status,404);
  assert.ok(guest.sent.some(message=>message.type==='closed'));
});

test('room creation rejects unapproved web origins',async()=>{
  const {env}=harness();
  const response=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/rooms','POST',{Origin:'https://untrusted.example'}),env);
  assert.equal(response.status,403);
});

test('leaderboard GET still works after room changes',async()=>{
  const {env}=harness();
  const response=await runtime.workerDefault.fetch(mockRequest('https://example.test/leaderboard'),env);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).scores,[]);
});

test('Connected human ghosts keep control even when movement packets arrive late',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const start=html.indexOf('  const neutralDirection=()=>');
  const end=html.indexOf('  function lobbyPlayerProfile()',start);
  assert.ok(start>0&&end>start,'Movement ownership helper exists in game source');
  const helpers=html.slice(start,end);
  const humanSeatDirection=new Function(helpers+';return humanSeatDirection;')();
  const room={seats:[0,4],inputs:new Map()};
  // Connected human ghost 4 must remain still, not be handed to botDirection.
  assert.deepEqual(humanSeatDirection(room,4,1200),{x:0,y:0,mag:0});
  room.inputs.set(4,{x:.5,y:0,mag:.5,at:1200,seq:1});
  assert.deepEqual(humanSeatDirection(room,4,1250),
    {x:.5,y:0,mag:.5,at:1200,seq:1});
  assert.deepEqual(humanSeatDirection(room,4,1600),{x:0,y:0,mag:0},
    'Stale human inputs yield neutral movement rather than bot AI');
  assert.equal(humanSeatDirection(room,5,1600),null,
    'Unoccupied ghost seats retain computer opponents');

  assert.match(html,/const humanInput=isOnlineHost\(\)\?humanSeatDirection/);
  assert.match(html,/humanInput\?\?botDirection\(g,dt\)/);
  assert.match(html,/seq:\+\+online\.inputSeq/);
  assert.match(html,/humanSeats:online\.seats/);
  assert.match(html,/★ YOU/);
});
