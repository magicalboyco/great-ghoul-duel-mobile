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
  constructor(body='',opts={}){this.body=body;this.status=opts.status??200;this.ok=this.status>=200&&this.status<300;this.webSocket=opts.webSocket;this.headers=opts.headers??{}}
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
  return {url,method,headers:{get:key=>headers[key]??null},
    text:async()=>JSON.stringify(payload),json:async()=>payload};
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
  const humanStart=html.indexOf('  function humanSeatDirection(',start);
  const helpers=html.slice(start,html.indexOf('\n',start)+1)+html.slice(humanStart,end);
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

test('Every match ghost uses team uniform, not its personal pastel',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const start=html.indexOf('  function ghostBodyColor(g)');
  const end=html.indexOf('\n',start);
  assert.ok(start>0&&end>start,'Team uniform color resolver exists');
  const source=html.slice(start,end);
  const getColor=new Function('color',source+';return ghostBodyColor;')(
    team=>['#B8DDC4','#D98A91'][team]);
  for(let i=0;i<8;i++){
    const g={id:i,team:i<4?0:1,playerColor:'#A7D3EA'};
    assert.equal(getColor(g),i<4?'#B8DDC4':'#D98A91',
      'Individual preferences must never change match body colors');
  }
  assert.match(html,/const baseColor=ghostBodyColor\(g\),edge=/,
    'Canvas ghost body and glow use uniform');
  assert.match(html,/const fill=previewColor\?\?ghostBodyColor\(g\),accent=/,
    'Results and match portraits use uniform unless explicit lobby preview');
  assert.match(html,/ctx\.fillStyle=g\.playerColor;ctx\.fill\(\);/,
    'Personal color is still available as a small accessory');
});

test('Alpha 23: distinct Boo Crew costume per seat, humans take priority over bots',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const start=html.indexOf('  function resolveDistinctMatchStyles(');
  const end=html.indexOf('  function reset() {',start);
  assert.ok(start>0&&end>start,'Pure roster resolver must exist');
  const source=html.slice(start,end);
  const resolve=new Function(source+';return resolveDistinctMatchStyles;')();
  const run=(profiles,seats)=>{
    const styles=resolve(new Map(profiles),seats);
    assert.equal(styles.length,8);
    assert.equal(new Set(styles).size,8,'Every ghost has a distinct costume');
    assert.ok(styles.every(id=>Number.isInteger(id)&&id>=0&&id<8));
    return styles;
  };
  const normal=run([[0,{styleId:5}],[4,{styleId:2}]],[0,4]);
  assert.equal(normal[0],5,'Host keeps Batty Boo');
  assert.equal(normal[4],2,'Guest keeps Abra-ca-dabra');
  assert.equal(normal.filter(id=>id===5).length,1,'No bot duplicates Batty Boo');
  const conflicting=run([[0,{styleId:5}],[4,{styleId:5}]],[4,0]);
  assert.equal(conflicting[0],5,'First occupied seat retains selected character');
  assert.notEqual(conflicting[4],5,'Second human gets an available character');
  const full=run(Array.from({length:8},(_,id)=>[id,{styleId:5}]),
    Array.from({length:8},(_,i)=>i));
  assert.equal(new Set(full).size,8,'Eight human players all receive distinct costumes');
  const botOnly=run([],[]);
  assert.equal(new Set(botOnly).size,8);
  assert.match(html,/applyHumanProfiles\(\);/);
  assert.match(html,/g\.styleId=styles\[g\.id\]/);
});

test('Alpha 23: illustrated pillar and pumpkins replace placeholder scenery',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const backdrop=readFileSync(new URL('../../assets/boo-crew-night.svg',import.meta.url),'utf8');
  assert.match(html,/function drawGothicPillar\(ctx,wall\)/);
  assert.match(html,/wall\.type==='pillar'\)drawGothicPillar/);
  assert.match(html,/function drawPumpkin\(ctx,p\)/);
  assert.match(backdrop,/id="pumpkinBody"/);
  assert.match(backdrop,/id="pumpkinCandle"/);
  assert.doesNotMatch(backdrop,/<ellipse rx="60" ry="53" fill="#eb883a"/);
  assert.equal((backdrop.match(/<g[\s>]/g)||[]).length,
    (backdrop.match(/<\/g>/g)||[]).length,'SVG groups are balanced');
  assert.match(html,/function collides\(x, y, r = 19\)/,
    'Art changes must not replace collision boxes');
});

test('Alpha 23: portrait layout respects safe areas and app-like installation',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const manifest=JSON.parse(readFileSync(new URL('../../manifest.webmanifest',import.meta.url),'utf8'));
  const icon=readFileSync(new URL('../../assets/boo-crew-icon.svg',import.meta.url),'utf8');
  assert.match(html,/height:100dvh/);
  assert.match(html,/safe-area-inset-bottom/);
  assert.match(html,/visualViewport\.addEventListener\('resize',resize/);
  assert.match(html,/W\/WORLD\.w,H\/WORLD\.h/,'Camera zoom keeps scenery edge-to-edge');
  assert.match(html,/halfHeight>=WORLD\.h\/2/,'Portrait camera can center oversized world view');
  assert.equal(manifest.display,'standalone');
  assert.ok(manifest.icons.some(entry=>entry.src==='assets/boo-crew-icon.svg'));
  assert.match(icon,/<svg[^>]*viewBox="0 0 192 192"/);
});

test('Alpha 24: team uniform follows each team captain and guest sees own base',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const a=html.indexOf('  function resolveOnlineTeamColors(');
  const b=html.indexOf('  function syncOnlineTeamColors()',a);
  assert.ok(a>0&&b>a);
  const PASTELS=[
    {hex:'#D98A91'},{hex:'#E8AD87'},{hex:'#F2DF9D'},
    {hex:'#B8DDC4'},{hex:'#A7D3EA'},{hex:'#C9B9E5'},{hex:'#F1B4D5'}
  ];
  const resolve=new Function('PASTELS',html.slice(a,b)+';return resolveOnlineTeamColors;')(PASTELS);
  const duo=new Map([[0,{color:'#B8DDC4'}],[4,{color:'#F2DF9D'}]]);
  assert.deepEqual(resolve(duo,[0,4],'#B8DDC4').map(x=>x.hex),['#B8DDC4','#F2DF9D']);
  const same=resolve(new Map([[0,{color:'#A7D3EA'}],[4,{color:'#A7D3EA'}]]),[0,4],'#A7D3EA');
  assert.notEqual(same[0].hex,same[1].hex,'Two teams must remain distinguishable');
  const multiple=new Map([[0,{color:'#B8DDC4'}],[1,{color:'#C9B9E5'}],[4,{color:'#E8AD87'}]]);
  assert.equal(resolve(multiple,[4,1,0],'#B8DDC4')[0].hex,'#B8DDC4');
  assert.match(html,/team===ownTeam\?'YOUR BASE':'OTHER TEAM BASE'/);
});

test('Alpha 24: guest unlocks sound by tapping Join and can hear local scoring',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html,/onlineJoinEl\.addEventListener\('click',\(\)=>\{GhostAudio\.unlock\(\);startOnlineConnection\(false\)\}/);
  assert.match(html,/onlineCreateEl\.addEventListener\('click',\(\)=>\{GhostAudio\.unlock\(\);startOnlineConnection\(true\)\}/);
  assert.match(html,/function unlock\(\)\{/);
  assert.match(html,/if\(!s\.compact&&isOnlineGuest\(\)/);
  assert.match(html,/GhostAudio\.effect\('deposit'\)/);
  assert.match(html,/GhostAudio\.effect\('collect'\)/);
});

test('Alpha 24: compact snapshots reduce network traffic, retaining full state periodically',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const start=html.indexOf('  function publishOnlineSnapshot(){');
  const end=html.indexOf('  function receiveOnlineSnapshot(',start);
  assert.ok(start>0&&end>start);
  const producer=new Function('online','game','teamColors','performance','sendOnline','isOnlineHost',
    html.slice(start,end)+';return publishOnlineSnapshot;');
  const messages=[];
  let time=500;
  const online={lastFullSnapshot:-Infinity,seats:[0,4]};
  const ghost=id=>({
    id,team:id<4?0:1,styleId:id,x:100+id,y:200+id,heading:1,
    trail:Array(30).fill(1),trailPos:Array.from({length:30},(_,i)=>({x:i,y:i*2})),
    score:10,face:'happy',reaction:'',reactionTime:0,reactionDuration:0,
    bounce:1,blink:1,moveAmount:1,stats:{collected:10,stolen:0},playerColor:null,human:id===0||id===4
  });
  const game={
    remaining:110,phase:'playing',scores:[10,15],difficulty:'normal',
    ghosts:Array.from({length:8},(_,id)=>ghost(id)),
    flames:Array.from({length:72},(_,id)=>({x:id*10,y:id*6,phase:0}))
  };
  const publish=producer(online,game,[{hex:'#B8DDC4'},{hex:'#F2DF9D'}],
    {now:()=>time},msg=>messages.push(msg),()=>true);
  publish();
  assert.equal(messages[0].state.compact,undefined);
  time=580;publish();
  assert.equal(messages[1].state.compact,true);
  assert.equal(messages[1].state.flames,undefined);
  time=760;publish();
  assert.ok(messages[2].state.flames,'Periodic full state includes trails and flames');
  const fullBytes=JSON.stringify(messages[0]).length;
  const compactBytes=JSON.stringify(messages[1]).length;
  assert.ok(compactBytes<fullBytes*.3,'Compact packet must be under 30% of full packet');
  assert.match(html,/ghost\.viewX=lerp\(ghost\.viewX,ghost\.x,\.32\)/);
  assert.match(html,/try\{drawGhost\(g\)\}finally\{g\.x=sourceX;g\.y=sourceY;\}/);
});

test('Alpha 24: official Worker is prefilled; private host token stays out of invite links',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html,/const DEFAULT_ROOM_SERVER='https:\/\/ghost-duel-rooms\.jonathanjoyner\.workers\.dev'/);
  assert.match(html,/onlineServerEl\.value=DEFAULT_ROOM_SERVER/);
  assert.match(html,/id="onlineServerAdvanced"/);
  assert.match(html,/only needs this link/);
  assert.doesNotMatch(html,/hostToken[^;\n]*localStorage/);
});

test('Alpha 25: every team gets a readable engraved nameplate, including pale colors',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const start=html.indexOf('  function drawBaseNameplate(ctx,base,team){');
  const end=html.indexOf('  function drawEnvironment() {',start);
  assert.ok(start>0&&end>start,'Illustrated base nameplate exists');
  const segment=html.slice(start,end);
  assert.match(segment,/const title=teamColors\[team\]\.name\.toUpperCase\(\)/);
  assert.match(segment,/team===ownTeam\?'YOUR BASE':'OTHER TEAM BASE'/);
  assert.match(segment,/ctx\.fillStyle='#20152ff0'/,'Opaque dark plaque supports light team colors');
  assert.match(segment,/ctx\.strokeStyle=color\(team\)/,'Accent outline identifies team');
  assert.match(segment,/ctx\.fillStyle='#fff4d6'/,'Cream text contrasts with plaque');
  assert.match(segment,/ctx\.strokeText\(title,x,y-9\)/,'Outline prevents lettering from disappearing');
  assert.match(segment,/ctx\.measureText\(title\)\.width>width-36/,'Long colorway labels auto-fit');
  assert.match(segment,/ctx\.save\(\)/);
  assert.match(segment,/ctx\.restore\(\)/);
  assert.doesNotMatch(html,/ctx\.fillText\(game\.online\?\(team===myTeam/,
    'Plain same-color base lettering is no longer used');
});

test('Alpha 25: illustrated cobblestones are cached, seeded and rendered below spirits',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const start=html.indexOf('  function buildGraveyardPathLayer(){');
  const end=html.indexOf('  function drawBaseNameplate(ctx,base,team){',start);
  assert.ok(start>0&&end>start);
  const path=html.slice(start,end);
  assert.match(path,/document\.createElement\('canvas'\)/);
  assert.match(path,/let state=0x4a4f5948/,'Procedural art uses local repeatable seed');
  assert.match(path,/Math\.imul\(state,1664525\)/);
  assert.match(path,/const fills=\[/);
  assert.match(path,/p\.quadraticCurveTo/,'Stones have hand-shaped rounded edges');
  assert.match(path,/p\.fillStyle='#4e634e88'/,'Grass vegetation is drawn at path edges');
  assert.match(html,/let graveyardPathLayer=null/);
  assert.match(html,/if\(!graveyardPathLayer\)graveyardPathLayer=buildGraveyardPathLayer\(\)/);
  const envStart=html.indexOf('  function drawEnvironment() {');
  const envEnd=html.indexOf('  function drawParticles() {',envStart);
  const env=html.slice(envStart,envEnd);
  const pathDraw=env.indexOf('ctx.drawImage(graveyardPathLayer,0,550-88)');
  const propsDraw=env.indexOf('for (const p of props)');
  const baseDraw=env.indexOf('drawBaseNameplate(ctx,b,team)');
  assert.ok(pathDraw>=0&&propsDraw>pathDraw&&baseDraw>propsDraw,
    'Cached path sits underneath scenery and the base plaques');
  assert.doesNotMatch(env,/ctx\.lineWidth = 74; ctx\.lineCap = 'round'/,
    'Old flat runway stripe is removed');
  assert.match(html,/function collides\(x, y, r = 19\)/,
    'Existing gameplay collision function is untouched');
});

test('Alpha 26: Easy/Normal/Hard rival AI pressure increases without runaway speed',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const start=html.indexOf('  const DIFFICULTIES={');
  const end=html.indexOf('  let selectedDifficulty=',start);
  assert.ok(start>0&&end>start,'Difficulty configuration is available');
  const config=new Function(html.slice(start,end)+';return {DIFFICULTIES,FRIENDLY_BOT_CONFIG};')();
  const {easy,normal,hard}=config.DIFFICULTIES;
  const before={
    easy:{speed:.79,thinkMin:1.15,thinkMax:1.75,chaseChance:.06,chaseRadius:190},
    normal:{speed:1,thinkMin:.3,thinkMax:.85,chaseChance:.35,chaseRadius:270},
    hard:{speed:1.13,thinkMin:.16,thinkMax:.36,chaseChance:.68,chaseRadius:415}
  };
  for(const [name,profile,pressure] of [['easy',easy,.10],['normal',normal,.15],['hard',hard,.20]]){
    assert.ok(profile.speed>=before[name].speed&&
      profile.speed<=before[name].speed*1.06,
      name+' movement boost is modest (no 20% speed shock)');
    assert.ok(profile.thinkMin<=before[name].thinkMin*(1-pressure+.02));
    assert.ok(profile.thinkMax<=before[name].thinkMax*(1-pressure+.02));
    assert.ok(profile.chaseChance>=before[name].chaseChance*(1+pressure-.02));
    assert.ok(profile.chaseRadius>=before[name].chaseRadius*(1+pressure-.02));
    assert.equal(profile.bankAt,{easy:3,normal:5,hard:7}[name],
      'Preserve each skill tier banking identity');
  }
  assert.equal(config.FRIENDLY_BOT_CONFIG.speed,1);
  assert.equal(config.FRIENDLY_BOT_CONFIG.thinkMin,.3);
  assert.equal(config.FRIENDLY_BOT_CONFIG.chaseChance,.35);
  assert.ok(easy.speed<normal.speed&&normal.speed<hard.speed);
  assert.ok(easy.thinkMin>normal.thinkMin&&normal.thinkMin>hard.thinkMin);
});

test('Alpha 26: guest and host humans have equal movement speeds at all difficulties',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const start=html.indexOf('  function isComputerGhost(g){');
  const end=html.indexOf('  function botDirection(g, dt) {',start);
  assert.ok(start>0&&end>start);
  const profileSource=html.slice(start,end);
  const profiles={easy:{speed:.82},normal:{speed:1.04},hard:{speed:1.18}};
  const ally={speed:1};
  for(const difficulty of ['easy','normal','hard']){
    const game={online:true,difficulty};
    const online={seats:[0,4]};
    const helpers=new Function('game','online','DIFFICULTIES','FRIENDLY_BOT_CONFIG',
      profileSource+';return {isComputerGhost,movementSpeedFactor};')(
        game,online,profiles,ally);
    assert.equal(helpers.movementSpeedFactor({id:0,team:0}),1,
      'Host human seat 0 moves at normal speed');
    assert.equal(helpers.movementSpeedFactor({id:4,team:1}),1,
      'Guest human seat 4 is not sped up by rival difficulty');
    assert.equal(helpers.movementSpeedFactor({id:5,team:1}),profiles[difficulty].speed,
      'Rival bot gets its intended difficulty speed');
    assert.equal(helpers.movementSpeedFactor({id:1,team:0}),1,
      'Friendly bot stays at baseline speed');
  }
  const solo=new Function('game','online','DIFFICULTIES','FRIENDLY_BOT_CONFIG',
    profileSource+';return {isComputerGhost,movementSpeedFactor};')(
      {online:false,difficulty:'hard'},null,profiles,ally);
  assert.equal(solo.movementSpeedFactor({id:0,team:0}),1);
  assert.equal(solo.movementSpeedFactor({id:4,team:1}),1.18);
  assert.match(html,/const speed=172\*\(score>=8\?1\.48:1\)\*movementSpeedFactor\(g\)/);
});

test('Alpha 26: power-up spirit requirements stay fixed across difficulty modes',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html,/const POWER_STEPS=\[8,23,53,113\]/);
  for(const [name,spirits] of [['Speed',8],['Glow',23],['Magnet',53],['Phase',113]]){
    assert.ok(html.includes("name:'"+({Speed:'⚡ Speed',Glow:'✨ Glow',Magnet:'🧲 Magnet',Phase:'👻 Phase'}[name])+"',at:"+spirits),
      name+' power threshold stays unchanged');
  }
  assert.match(html,/function levelFor\(g\)\{return g\.trail\.length\}/);
});


test('Alpha 27: Boo Crew Co-op room securely seats four humans together and blocks a fifth',async()=>{
  const {env,instances}=harness();
  const created=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/rooms','POST',
    {Origin:'https://magicalboyco.github.io'},{mode:'coop'}),env);
  assert.equal(created.status,201);
  const {code,hostToken,mode}=await created.json();
  assert.equal(mode,'coop');
  const status=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/rooms/'+code),env);
  assert.deepEqual((({mode,maxPlayers,started})=>({mode,maxPlayers,started}))(await status.json()),
    {mode:'coop',maxPlayers:4,started:false});
  const room=instances.get('room-'+code).room;
  const sockets=instances.get('room-'+code).sockets;
  async function enter(role,profile={}){
    const response=await runtime.workerDefault.fetch(mockRequest(
      'https://example.test/room/'+code,'GET',{Upgrade:'websocket'}),env);
    assert.equal(response.status,101);
    const socket=sockets.at(-1);
    await room.webSocketMessage(socket,JSON.stringify({
      type:'hello',role,...profile,
      ...(role==='host'?{token:hostToken}:{})
    }));
    return socket;
  }
  const host=await enter('host',{styleId:0,color:'#B8DDC4'});
  const guests=[];
  for(let i=0;i<3;i++){
    const guest=await enter('guest',{styleId:i+1,color:'#F2DF9D'});
    guests.push(guest);
    assert.equal(guest.deserializeAttachment().seat,i+1);
    assert.equal(guest.sent[0].mode,'coop');
  }
  assert.deepEqual([...room.players.keys()].sort(),[0,1,2,3],
    'All human players are in the first team; seats 4–7 remain rival bots');
  assert.equal(room.mode,'coop');
  const roster=guests[2].sent.findLast(message=>message.type==='roster');
  assert.equal(roster.mode,'coop');
  assert.deepEqual(roster.seats,[0,1,2,3]);
  const fifth=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/room/'+code,'GET',{Upgrade:'websocket'}),env);
  assert.equal(fifth.status,409,'A fifth human cannot join a four-human co-op room');
  await room.webSocketMessage(host,JSON.stringify({type:'start'}));
  const prepare=host.sent.find(message=>message.type==='prepare');
  assert.equal(prepare.mode,'coop');
  for(const socket of [host,...guests]){
    await room.webSocketMessage(socket,JSON.stringify({type:'ready',roundId:prepare.roundId}));
  }
  assert.equal(room.preparing,false);
  assert.ok(guests.every(g=>g.sent.some(m=>m.type==='start'&&m.mode==='coop')));
  await room.webSocketMessage(guests[0],JSON.stringify({type:'input',seq:1,x:.5,y:0}));
  assert.ok(host.sent.some(m=>m.type==='input'&&m.seat===1&&m.seq===1),
    'Co-op guest controls reach the host physics, not the bot AI');
});

test('Alpha 27: Classic Duel keeps alternating teams and eight-person capacity',async()=>{
  const {env,instances}=harness();
  const created=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/rooms','POST',
    {Origin:'https://magicalboyco.github.io'},{mode:'classic'}),env);
  assert.equal(created.status,201);
  const {code,hostToken,mode}=await created.json();
  assert.equal(mode,'classic');
  const room=instances.get('room-'+code).room;
  const sockets=instances.get('room-'+code).sockets;
  async function enter(role){
    const response=await runtime.workerDefault.fetch(mockRequest(
      'https://example.test/room/'+code,'GET',{Upgrade:'websocket'}),env);
    assert.equal(response.status,101);
    const socket=sockets.at(-1);
    await room.webSocketMessage(socket,JSON.stringify({
      type:'hello',role,styleId:0,color:'#A7D3EA',
      ...(role==='host'?{token:hostToken}:{})
    }));
    return socket;
  }
  const host=await enter('host');
  const others=[];
  for(let i=0;i<7;i++)others.push(await enter('guest'));
  assert.deepEqual([host,...others].map(socket=>socket.deserializeAttachment().seat),
    [0,4,1,5,2,6,3,7]);
  assert.equal(room.mode,'classic');
  assert.equal(room.players.size,8);
  const ninth=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/room/'+code,'GET',{Upgrade:'websocket'}),env);
  assert.equal(ninth.status,409);
  const status=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/rooms/'+code),env);
  assert.equal((await status.json()).maxPlayers,8);
});

test('Alpha 27: new modes and old Worker fallback remain explicit and safe',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html,/data-mode="coop"/);
  assert.match(html,/data-mode="classic"/);
  assert.match(html,/Four-Way Haunt/);
  assert.match(html,/aria-disabled="true"/);
  assert.match(html,/function selectOnlineMode\(mode\)/);
  assert.match(html,/roomCapacity=mode=>mode==='coop'\?4:8/);
  assert.match(html,/mode:selectedOnlineMode/);
  assert.match(html,/JSON\.stringify\(\{mode:selectedOnlineMode\}\)/);
  assert.match(html,/includes\('coop'\)/);
  assert.match(html,/The server does not support the selected mode yet/);
  assert.match(html,/if\(MODE_NAMES\[msg\.mode\]\)session\.mode=msg\.mode/);
  assert.match(html,/room\.mode==='coop'\?\(team===0\?'Friendly Bot':'Rival Bot'\)/);
  assert.match(html,/mode==='coop'\?'BOO CREW CO-OP':'CLASSIC DUEL'/);
  assert.match(html,/const POWER_STEPS=\[8,23,53,113\]/);
  assert.match(html,/humanInput\?\?botDirection\(g,dt\)/);
});

test('Alpha 27 hotfix: health handshake allows GitHub Pages cross-origin Co-op requests',async()=>{
  const {env}=harness();
  const health=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/health','GET',{Origin:'https://magicalboyco.github.io'}),env);
  assert.equal(health.status,200);
  assert.equal(health.headers['Access-Control-Allow-Origin'],'*',
    'Health CORS must match /rooms so Safari can read the mode list');
  assert.deepEqual((await health.json()).modes,['classic','coop']);
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html,/const health=await fetch\(endpoint\+'\/health'/,
    'Co-op verifies the deployed Worker has the selected mode');
  assert.match(html,/Check your connection and the Worker deployment/,
    'Safari Load failed errors explain the actionable connection issue');
});


test('Alpha 28: narrow-screen menu shrinks inside the viewport and remains scrollable',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const css=html.slice(html.indexOf('/* Alpha 28 — Adaptive menu layout.'),html.indexOf('</style>'));
  assert.ok(css.length>2500,'Mobile-specific layout rules are present');
  assert.match(html,/<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">/);
  assert.match(css,/#menu>.panel\{\s*flex:0 1 780px;\s*width:100%;\s*max-width:780px;\s*min-width:0;/);
  assert.match(css,/overflow-x:hidden;\s*overflow-y:auto;/,
    'Menu is vertically scrollable without horizontal clipping');
  assert.match(css,/#menu \.title\{[\s\S]*?overflow-wrap:anywhere;/,
    'Long title wraps instead of growing the panel');
  assert.match(css,/@media \(max-width:520px\)\{/);
  assert.match(css,/#booCrewGrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:9px;\}/);
  assert.match(css,/\.crewCard span\{font-size:12px;min-height:15px;\}/);
  assert.match(css,/#onlinePanel input\{max-width:100%;font-size:16px;\}/,
    'iOS inputs avoid the under-16-pixel auto-zoom');
  assert.match(css,/#onlineRoster\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/);
  assert.match(css,/@media \(min-width:521px\) and \(max-width:679px\)\{/);
  assert.match(css,/@media \(max-height:520px\) and \(orientation:landscape\)\{/);
  assert.match(html,/const POWER_STEPS=\[8,23,53,113\]/,
    'Gameplay power thresholds stay unchanged');
});


test('Alpha 29: multiplayer display names are sanitized, broadcast and room-only',async()=>{
  const {env,instances}=harness();
  const created=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/rooms','POST',{Origin:'https://magicalboyco.github.io'},{mode:'coop'}),env);
  assert.equal(created.status,201);
  const {code,hostToken}=await created.json();
  const room=instances.get('room-'+code).room;
  const sockets=instances.get('room-'+code).sockets;
  const open=async()=> {
    const response=await runtime.workerDefault.fetch(mockRequest(
      'https://example.test/room/'+code,'GET',{Upgrade:'websocket'}),env);
    assert.equal(response.status,101);
    return sockets.at(-1);
  };
  const host=await open();
  await room.webSocketMessage(host,JSON.stringify({type:'hello',role:'host',token:hostToken,
    name:'  Moonbeam  ',styleId:2,color:'#B8DDC4'}));
  assert.equal(room.profiles.get(0).name,'Moonbeam','Names trim surrounding spaces');
  const guest=await open();
  await room.webSocketMessage(guest,JSON.stringify({type:'hello',role:'guest',
    name:'✨<script>alert(1)</script>',styleId:3,color:'#F1B4D5'}));
  assert.equal(room.profiles.get(1).name,'','Markup or emoji is not accepted as a name');
  await room.webSocketMessage(guest,JSON.stringify({type:'profile',name:'Spooky Pal',
    styleId:3,color:'#F1B4D5'}));
  assert.equal(room.profiles.get(1).name,'Spooky Pal');
  const roster=host.sent.filter(m=>m.type==='roster').at(-1);
  assert.ok(roster.profiles.some(p=>p.seat===1&&p.name==='Spooky Pal'));
  await room.webSocketMessage(guest,JSON.stringify({type:'profile',
    name:'This Name Is Far Too Long',styleId:3,color:'#F1B4D5'}));
  assert.equal(room.profiles.get(1).name,'','Names longer than 16 characters are refused');
  await room.webSocketMessage(host,JSON.stringify({type:'start'}));
  const prep=host.sent.find(m=>m.type==='prepare');
  assert.ok(prep.profiles.some(p=>p.seat===0&&p.name==='Moonbeam'),
    'The match begins with human identities from the lobby');
  assert.ok(prep.profiles.some(p=>p.seat===1&&p.name===''),
    'Invalid names remain optional without leaking unsafe input');
  const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/storage\.put\([^)]*(?:profile|playerName|\.name)/,
    'Room names do not become persistent leaderboard records');
});

test('Alpha 29: room nicknames are sanitized and synchronized to host and guests',async()=>{
  const {env,instances}=harness();
  const created=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/rooms','POST',{Origin:'https://magicalboyco.github.io'},
    {mode:'coop'}),env);
  assert.equal(created.status,201);
  const {code,hostToken}=await created.json();
  const {room,sockets}=instances.get('room-'+code);
  async function enter(role,profile){
    const response=await runtime.workerDefault.fetch(mockRequest(
      'https://example.test/room/'+code,'GET',{Upgrade:'websocket'}),env);
    assert.equal(response.status,101);
    const socket=sockets.at(-1);
    await room.webSocketMessage(socket,JSON.stringify({type:'hello',role,
      ...(role==='host'?{token:hostToken}:{}),...profile}));
    return socket;
  }
  const host=await enter('host',{styleId:0,color:'#B8DDC4',name:'Boo Baron'});
  const guest=await enter('guest',{styleId:1,color:'#C9B9E5',name:'  Lúcia Moon  '});
  assert.equal(room.profiles.get(0).name,'Boo Baron');
  assert.equal(room.profiles.get(1).name,'Lúcia Moon');
  const roster=host.sent.findLast(m=>m.type==='roster');
  assert.equal(roster.profiles.find(p=>p.seat===1)?.name,'Lúcia Moon',
    'The host sees a guest-selected nickname');
  const guestRoster=guest.sent.findLast(m=>m.type==='roster');
  assert.equal(guestRoster.profiles.find(p=>p.seat===0)?.name,'Boo Baron',
    'The guest sees the host name');
  await room.webSocketMessage(guest,JSON.stringify({
    type:'profile',styleId:1,color:'#C9B9E5',name:'Moonlit Fox'
  }));
  assert.equal(room.profiles.get(1).name,'Moonlit Fox',
    'Before the match a guest may change their own nickname');
  await room.webSocketMessage(guest,JSON.stringify({
    type:'profile',styleId:1,color:'#C9B9E5',name:'<img src=x>'
  }));
  assert.equal(room.profiles.get(1).name,'',
    'HTML and markup are rejected by the Worker');
  await room.webSocketMessage(guest,JSON.stringify({
    type:'profile',styleId:1,color:'#C9B9E5',name:'Name👻'
  }));
  assert.equal(room.profiles.get(1).name,'',
    'Unsupported characters are not sent to other players');
  await room.webSocketMessage(guest,JSON.stringify({
    type:'profile',styleId:1,color:'#C9B9E5',name:'Spooky Specter 123'
  }));
  assert.equal(room.profiles.get(1).name,'',
    'Names longer than 16 code units are rejected');
  await room.webSocketMessage(guest,JSON.stringify({
    type:'profile',styleId:1,color:'#C9B9E5',name:'Gusty'
  }));
  await room.webSocketMessage(host,JSON.stringify({type:'start'}));
  assert.equal(host.sent.find(m=>m.type==='prepare')?.profiles
    .find(p=>p.seat===1)?.name,'Gusty');
  await room.webSocketMessage(guest,JSON.stringify({
    type:'profile',styleId:1,color:'#C9B9E5',name:'Changed During Play'
  }));
  assert.equal(room.profiles.get(1).name,'Gusty',
    'Player names cannot be rewritten during an active round');
});

test('Alpha 29: player name field, lobby, match and mobile sizing stay integrated',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html,/<input id="playerDisplayName"[^>]+maxlength="16"/,
    'Every player can type a name before creating or joining');
  assert.match(html,/function sanitizePlayerName\(value\)/);
  assert.match(html,/name:sanitizePlayerName\(playerDisplayNameEl\.value\)/,
    'The chosen name is sent with the socket hello/profile');
  assert.match(html,/type:'profile',\.\.\.lobbyPlayerProfile\(\)/,
    'Live lobby name changes propagate to connected friends');
  assert.match(html,/name:sanitizePlayerName\(p\.name\)/,
    'Roster parsing accepts the server-sanitized player name');
  assert.match(html,/g\.playerName=human\?sanitizePlayerName\(profile\?\.name\)/);
  assert.match(html,/playerName:g\.playerName\|\|''/,
    'Authoritative full match snapshots preserve names');
  assert.match(html,/sanitizePlayerName\(g\.playerName\)/,
    'In-game labels display player names');
  assert.match(html,/sanitizePlayerName\(ghost\.playerName\)/,
    'End-of-match awards display player names');
  assert.match(html,/ctx\.fillText\(text,x,y-49,width-12\)/,
    'Name badges fit their canvas panels');
  assert.match(html,/-webkit-text-size-adjust:100%/,
    'Safari must not inflate already responsive menu text');
  assert.match(html,/text-size-adjust:100%/);
  assert.match(html,/#menu>.panel\{\s*margin:auto;\s*flex:none;/,
    'Small-screen setup panel respects viewport and keeps scrolling');
  assert.match(html,/font-size:16px;/,'Input text avoids iOS focus zoom');
  assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/,
    'Pinch zoom must remain accessible');
  assert.match(html,/const POWER_STEPS=\[8,23,53,113\]/,
    'Power-up requirements stay intact');
});


test('Alpha 34: Four-Way Haunt reserves eight seats across four teams and synchronizes rounds',async()=>{
  const {env,instances}=harness();
  const health=await runtime.workerDefault.fetch(mockRequest('https://example.test/health'),env);
  assert.deepEqual((await health.json()).modes,['classic','coop','fourway']);
  const created=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/rooms','POST',{Origin:'https://magicalboyco.github.io'},
    {mode:'fourway'}),env);
  assert.equal(created.status,201);
  const {code,hostToken,mode}=await created.json();
  assert.equal(mode,'fourway');
  const status=await runtime.workerDefault.fetch(mockRequest('https://example.test/rooms/'+code),env);
  assert.deepEqual({mode:(await status.json()).mode,maxPlayers:(await status.json()).maxPlayers},
    {mode:'fourway',maxPlayers:8});
  const {room,sockets}=instances.get('room-'+code);
  const joined=[];
  for(let i=0;i<8;i++){
    const response=await runtime.workerDefault.fetch(mockRequest(
      'https://example.test/room/'+code,'GET',{Upgrade:'websocket'}),env);
    assert.equal(response.status,101);
    const socket=sockets.at(-1);
    await room.webSocketMessage(socket,JSON.stringify({
      type:'hello',role:i===0?'host':'guest',
      ...(i===0?{token:hostToken}:{}),
      styleId:i,color:'#B8DDC4',name:'Ghost '+i
    }));
    joined.push(socket);
  }
  assert.deepEqual(joined.map(socket=>socket.deserializeAttachment().seat),
    [0,2,4,6,1,3,5,7],
    'First four humans occupy four distinct teams');
  const extraSocket=await runtime.workerDefault.fetch(mockRequest(
    'https://example.test/room/'+code,'GET',{Upgrade:'websocket'}),env);
  assert.equal(extraSocket.status,409);
  const roster=joined[0].sent.findLast(msg=>msg.type==='roster');
  assert.equal(roster.mode,'fourway');
  assert.equal(roster.profiles.length,8);
  await room.webSocketMessage(joined[0],JSON.stringify({type:'start'}));
  const prepare=joined[0].sent.find(msg=>msg.type==='prepare');
  assert.equal(prepare.mode,'fourway');
  assert.equal(prepare.seats.length,8);
  for(const socket of joined){
    await room.webSocketMessage(socket,JSON.stringify({type:'ready',roundId:prepare.roundId}));
  }
  assert.equal(joined.every(socket=>socket.sent.some(msg=>msg.type==='start'&&msg.mode==='fourway')),true);
});

test('Alpha 34: Four-Way Haunt client has four-team arena, scoring and UI safeguards',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  assert.match(html,/data-mode="fourway"/);
  assert.match(html,/FOURWAY_WORLD=\{w:2400,h:1500\}/);
  assert.match(html,/scores: Array\(matchMode==='fourway'\?4:2\)\.fill\(0\)/);
  assert.match(html,/teamForSeat=\(seat,mode\)=>mode==='fourway'\?Math\.floor\(seat\/2\)/);
  assert.match(html,/s\.scores\.length!==\(isFourWay\(\)\?4:2\)/);
  assert.match(html,/BASES\.every\(base=>distance\(p,base\)>base\.r\+55\)/);
  assert.match(html,/game\.scores\.map\(\(score,i\)=>/);
  assert.match(html,/scoreEls\.forEach/);
  assert.match(html,/localLocatorUntil:performance\.now\(\)\+5000/);
  assert.match(html,/const POWER_STEPS=\[8,23,53,113\]/);
});
