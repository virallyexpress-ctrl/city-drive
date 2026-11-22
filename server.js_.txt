// Drive – tiny multiplayer relay + static host.  Run: npm install && node server.js
const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const PORT=process.env.PORT||8080,MAX=10;
/* ---------- Telegram login (optional): set TG_TOKEN in the host's environment variables ---------- */
const crypto=require('crypto'),https=require('https');
const TG_TOKEN=process.env.TG_TOKEN||'',TG_API=process.env.TG_API||'https://api.telegram.org';
let TG_BOT='';const tgPend=new Map();
function tgCall(method,body){return new Promise((res,rej)=>{
  const u=new URL(TG_API+'/bot'+TG_TOKEN+'/'+method),d=JSON.stringify(body||{});
  const rq=(u.protocol==='http:'?http:https).request(u,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(d)},timeout:40000},r=>{
    let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{const j=JSON.parse(b);j.ok?res(j.result):rej(new Error(j.description||'tg'));}catch(e){rej(e);}});});
  rq.on('error',rej);rq.on('timeout',()=>rq.destroy(new Error('timeout')));rq.end(d);});}
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const mac=p=>crypto.createHmac('sha256',TG_TOKEN).update(p).digest('base64url');
function tgSign(o){const p=b64(o);return p+'.'+mac(p);}
function tgVerify(s){
  if(!TG_TOKEN||typeof s!=='string')return null;const i=s.indexOf('.');if(i<1)return null;
  const p=s.slice(0,i),g=Buffer.from(s.slice(i+1)),w=Buffer.from(mac(p));
  if(g.length!==w.length||!crypto.timingSafeEqual(g,w))return null;
  try{const o=JSON.parse(Buffer.from(p,'base64url').toString());return o.exp>Date.now()?o:null;}catch(e){return null;}
}
const tgName=f=>String(f.first_name||f.username||'Driver').replace(/[<>&"']/g,'').trim().slice(0,12)||'Driver';
async function tgUpdate(u){
  if(u.message&&typeof u.message.text==='string'){
    const m=u.message,tok=(m.text.match(/^\/start\s+([a-f0-9]{16})$/)||[])[1],p=tok&&tgPend.get(tok);
    if(/^\/id\b/.test(m.text))return tgCall('sendMessage',{chat_id:m.chat.id,text:'Your Telegram ID: '+m.from.id});
    if(!p||p.exp<Date.now())return tgCall('sendMessage',{chat_id:m.chat.id,text:'Drive: open the game, press "Log in with Telegram" and scan the QR code.'});
    return tgCall('sendMessage',{chat_id:m.chat.id,text:'Log in to Drive as "'+tgName(m.from)+'"?',reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:'ok:'+tok},{text:'✖ Cancel',callback_data:'no:'+tok}]]}});
  }
  if(u.callback_query){
    const q=u.callback_query,mm=String(q.data||'').match(/^(ok|no):([a-f0-9]{16})$/),p=mm&&tgPend.get(mm[2]);let txt='This login request has expired.';
    if(p&&p.exp>Date.now()&&!p.done){
      if(mm[1]==='ok'){const name=tgName(q.from);p.done={name,id:q.from.id,s:tgSign({id:q.from.id,name,exp:Date.now()+30*864e5})};txt='✅ Logged in as "'+name+'". Go back to the game.';}
      else{tgPend.delete(mm[2]);txt='✖ Login cancelled.';}
    }
    tgCall('answerCallbackQuery',{callback_query_id:q.id}).catch(()=>{});
    if(q.message)return tgCall('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:txt});
  }
}
async function tgLoop(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));let off=0;
  for(;;){try{const me=await tgCall('getMe');TG_BOT=me.username;await tgCall('deleteWebhook',{});break;}catch(e){console.log('Telegram: '+e.message);await sleep(15000);}}
  console.log('Telegram login on: @'+TG_BOT);
  for(;;){try{const us=await tgCall('getUpdates',{offset:off,timeout:25,allowed_updates:['message','callback_query']});
    for(const u of us){off=u.update_id+1;tgUpdate(u).catch(()=>{});}}catch(e){await sleep(3000);}}
}
if(TG_TOKEN)tgLoop();
setInterval(()=>{const n=Date.now();for(const[k,v]of tgPend)if(v.exp<n)tgPend.delete(k);},60000);
const ADMINS=String(process.env.ADMIN_TG||'').split(',').map(x=>x.trim()).filter(Boolean);const isAdmin=id=>ADMINS.includes(String(id));
let POLICY_JSON='{}';try{POLICY_JSON=JSON.stringify(JSON.parse(process.env.POLICY_JSON||'{}'));}catch(e){console.log('POLICY_JSON is not valid JSON – ignored');}
/* ---------- Access control: open to everyone, or invite only (admin switches it in the game) ---------- */
let ACCESS=/^invite/i.test(process.env.ACCESS_MODE||'')?'invite':'open';
const cookie=(req,k)=>{const m=String(req.headers.cookie||'').match(new RegExp('(?:^|;\\s*)'+k+'=([^;]+)'));return m?decodeURIComponent(m[1]):'';};
const hasPass=req=>{const o=tgVerify(cookie(req,'drvpass'));return !!(o&&o.pass);};
const passCookie=days=>'drvpass='+encodeURIComponent(tgSign({pass:1,exp:Date.now()+days*864e5}))+'; Path=/; Max-Age='+Math.round(days*86400)+'; HttpOnly; SameSite=Lax; Secure';
const allowed=req=>ACCESS==='open'||hasPass(req);
function lockedPage(){return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drive – invite only</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d1117;color:#fff;font-family:sans-serif;text-align:center}.b{max-width:360px;padding:24px}h1{font-size:22px}p{color:#b9c3d0;line-height:1.5}a,button{display:inline-block;margin-top:12px;padding:11px 16px;border-radius:10px;border:1px solid #444;background:#253041;color:#fff;font-size:15px;text-decoration:none;cursor:pointer}small{color:#6c7684}</style></head><body><div class="b"><h1>🔒 Drive is invite-only right now</h1><p>Ask the game owner for an invite link. Open the link on this device and you are in.</p>'+
  (TG_TOKEN&&TG_BOT?'<button id="adm">Admin? Log in with Telegram</button><p id="st"></p>':'')+'<br><small>© ViRally</small></div><script>const b=document.getElementById("adm");if(b)b.onclick=async()=>{const P=(u,o)=>fetch(u,{method:"POST",body:JSON.stringify(o||{})}).then(r=>r.json());const n=await P("/tg/new");if(!n.ok)return;window.open(n.url,"_blank");document.getElementById("st").textContent="Approve in Telegram, then come back…";const iv=setInterval(async()=>{const p=await P("/tg/poll",{token:n.token});if(p.gone)clearInterval(iv);if(p.ok){clearInterval(iv);try{localStorage.setItem("cd:tg",p.s);}catch(_){}const m=await P("/tg/me",{s:p.s});if(m.admin)location.reload();else document.getElementById("st").textContent="This Telegram account is not an admin.";}},2000);};</script></body></html>';}
function accessHttp(req,res,b){
  const out=(o,h)=>{res.writeHead(200,Object.assign({'Content-Type':'application/json','Cache-Control':'no-store'},h||{}));res.end(JSON.stringify(o));};
  let m={};try{m=JSON.parse(b||'{}');}catch(e){}const o=tgVerify(m.s);
  if(req.url.startsWith('/access/state'))return out({mode:ACCESS,admin:!!(o&&isAdmin(o.id))});
  if(!(o&&isAdmin(o.id)))return out({ok:false,err:'admin only'});
  if(req.url.startsWith('/access/set')){ACCESS=m.mode==='invite'?'invite':'open';console.log('Access mode: '+ACCESS);return out({ok:true,mode:ACCESS},{'Set-Cookie':passCookie(365)});}
  if(req.url.startsWith('/access/invite')){const days=Math.min(365,Math.max(0.04,+m.days||7));const t=tgSign({inv:1,exp:Date.now()+days*864e5});
    const host=req.headers['x-forwarded-host']||req.headers.host;return out({ok:true,url:'https://'+host+'/?inv='+encodeURIComponent(t),days});}
  out({ok:false});
}
function tgHttp(req,res){
  const out=o=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(o));};
  if(req.url.startsWith('/tg/info'))return out({on:!!(TG_TOKEN&&TG_BOT),bot:TG_BOT});
  let b='';req.on('data',c=>{b+=c;if(b.length>4000)req.destroy();});
  req.on('end',()=>{let m={};try{m=JSON.parse(b||'{}');}catch(e){}
    if(!(TG_TOKEN&&TG_BOT))return out({ok:false});
    if(req.url.startsWith('/tg/new')){if(tgPend.size>5000)return out({ok:false});const t=crypto.randomBytes(8).toString('hex');tgPend.set(t,{exp:Date.now()+5*60000,done:null});return out({ok:true,token:t,url:'https://t.me/'+TG_BOT+'?start='+t});}
    if(req.url.startsWith('/tg/poll')){const p=tgPend.get(String(m.token||''));if(!p)return out({ok:false,gone:true});if(!p.done)return out({ok:false});tgPend.delete(m.token);return out({ok:true,name:p.done.name,s:p.done.s,admin:isAdmin(p.done.id)});}
    if(req.url.startsWith('/tg/me')){const o=tgVerify(m.s);if(o&&isAdmin(o.id)){res.setHeader('Set-Cookie',passCookie(365));}return out(o?{ok:true,name:o.name,admin:isAdmin(o.id)}:{ok:false});}
    out({ok:false});});
}

const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/health')){res.end('ok');return;}
  if(req.url.startsWith('/policy')){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(POLICY_JSON);return;}
  if(req.url.startsWith('/tg/'))return tgHttp(req,res);
  if(req.url.startsWith('/access/')){let b='';req.on('data',c=>{b+=c;if(b.length>4000)req.destroy();});req.on('end',()=>accessHttp(req,res,b));return;}
  {const u=new URL(req.url,'http://x'),inv=u.searchParams.get('inv');
   if(inv){const o=tgVerify(inv);if(o&&o.inv){const left=(o.exp-Date.now())/864e5;res.writeHead(302,{'Set-Cookie':passCookie(Math.max(left,1)),Location:'/'});res.end();return;}
     if(!allowed(req)){res.writeHead(403,{'Content-Type':'text/html; charset=utf-8'});res.end(lockedPage().replace('Ask the game owner','This invite link has expired or is not valid. Ask the game owner for a new one'));return;}}
   if(!allowed(req)){res.writeHead(403,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(lockedPage());return;}}
  fs.readFile(path.join(__dirname,'public','index.html'),(e,d)=>{
    if(e){res.writeHead(404);res.end('Put the game file at public/index.html');return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(d);
  });
});
const wss=new WebSocketServer({server,maxPayload:30*1024*1024});
const rooms=new Map();let nextId=1;
const send=(ws,o)=>{if(ws.readyState===1)ws.send(JSON.stringify(o));};
function newCode(){const A='ABCDEFGHJKLMNPQRSTUVWXYZ';let c;do{c='';for(let i=0;i<4;i++)c+=A[Math.random()*A.length|0];}while(rooms.has(c));return c;}
function bcast(room,o,except){const s=JSON.stringify(o);for(const p of room.players)if(p!==except&&p.readyState===1)p.send(s);}
function leave(ws){
  if(!ws.room)return;const r=rooms.get(ws.room);ws.room=null;if(!r)return;
  r.players.delete(ws);bcast(r,{t:'left',id:ws.id});bcast(r,{t:'n',n:r.players.size});
  if(!r.players.size)rooms.delete([...rooms].find(([k,v])=>v===r)[0]);
}
function join(ws,code,creator){
  const r=rooms.get(code);r.players.add(ws);ws.room=code;if(creator)r.owner=ws.id;
  send(ws,{t:'room',code,id:ws.id,n:r.players.size,demo:r.demo,map:creator?null:r.map});
  bcast(r,{t:'n',n:r.players.size});
}
wss.on('connection',(ws,req)=>{
  if(req&&!allowed(req)){try{ws.close(4003,'invite only');}catch(e){}return;}
  ws.id=nextId++;ws.room=null;ws.alive=true;ws.on('pong',()=>{ws.alive=true;});
  ws.on('message',data=>{
    let m;try{m=JSON.parse(data.toString());}catch(e){return;}
    if(m.t==='create'){leave(ws);const c=newCode();rooms.set(c,{players:new Set(),map:null,demo:false,owner:0});join(ws,c,true);}
    else if(m.t==='join'){
      const c=String(m.code||'').toUpperCase().trim(),r=rooms.get(c);
      if(!r)return send(ws,{t:'err',m:'Room '+c+' not found'});
      if(r.players.size>=MAX)return send(ws,{t:'err',m:'Room is full (10 players)'});
      if(!r.map&&!r.demo)return send(ws,{t:'err',m:'Host is still loading – try again in a second'});
      leave(ws);join(ws,c,false);
    }
    else if(m.t==='map'&&ws.room){const r=rooms.get(ws.room);if(r&&r.owner===ws.id){r.map=m.map||null;r.demo=!!m.demo;}}
    else if(m.t==='tgauth'){const o=tgVerify(m.s);ws.tg=o?o.name:null;}
    else if(m.t==='s'&&ws.room){const r=rooms.get(ws.room);if(r){m.id=ws.id;if(ws.tg){m.tv=1;if('n' in m)m.n=ws.tg;}else delete m.tv;bcast(r,m,ws);}}
  });
  ws.on('close',()=>leave(ws));ws.on('error',()=>{});
});
setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;try{ws.ping();}catch(e){}}},30000);
server.listen(PORT,()=>console.log('Drive server on :'+PORT));
