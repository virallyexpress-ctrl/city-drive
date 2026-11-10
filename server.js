// ViRally Drive – tiny multiplayer relay + static host.  Run: npm install && node server.js
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
    if(!p||p.exp<Date.now())return tgCall('sendMessage',{chat_id:m.chat.id,text:'ViRally Drive: open the game, press "Log in with Telegram" and scan the QR code.'});
    return tgCall('sendMessage',{chat_id:m.chat.id,text:'Log in to ViRally Drive as "'+tgName(m.from)+'"?',reply_markup:{inline_keyboard:[[{text:'✅ Approve',callback_data:'ok:'+tok},{text:'✖ Cancel',callback_data:'no:'+tok}]]}});
  }
  if(u.callback_query){
    const q=u.callback_query,mm=String(q.data||'').match(/^(ok|no):([a-f0-9]{16})$/),p=mm&&tgPend.get(mm[2]);let txt='This login request has expired.';
    if(p&&p.exp>Date.now()&&!p.done){
      if(mm[1]==='ok'){const name=tgName(q.from);p.done={name,s:tgSign({id:q.from.id,name,exp:Date.now()+30*864e5})};txt='✅ Logged in as "'+name+'". Go back to the game.';}
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
function tgHttp(req,res){
  const out=o=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(o));};
  if(req.url.startsWith('/tg/info'))return out({on:!!(TG_TOKEN&&TG_BOT),bot:TG_BOT});
  let b='';req.on('data',c=>{b+=c;if(b.length>4000)req.destroy();});
  req.on('end',()=>{let m={};try{m=JSON.parse(b||'{}');}catch(e){}
    if(!(TG_TOKEN&&TG_BOT))return out({ok:false});
    if(req.url.startsWith('/tg/new')){if(tgPend.size>5000)return out({ok:false});const t=crypto.randomBytes(8).toString('hex');tgPend.set(t,{exp:Date.now()+5*60000,done:null});return out({ok:true,token:t,url:'https://t.me/'+TG_BOT+'?start='+t});}
    if(req.url.startsWith('/tg/poll')){const p=tgPend.get(String(m.token||''));if(!p)return out({ok:false,gone:true});if(!p.done)return out({ok:false});tgPend.delete(m.token);return out({ok:true,name:p.done.name,s:p.done.s});}
    if(req.url.startsWith('/tg/me')){const o=tgVerify(m.s);return out(o?{ok:true,name:o.name}:{ok:false});}
    out({ok:false});});
}

const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/health')){res.end('ok');return;}
  if(req.url.startsWith('/tg/'))return tgHttp(req,res);
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
wss.on('connection',ws=>{
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
server.listen(PORT,()=>console.log('ViRally Drive server on :'+PORT));
