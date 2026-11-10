// City Drive – tiny multiplayer relay + static host.  Run: npm install && node server.js
const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const PORT=process.env.PORT||8080,MAX=10;
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/health')){res.end('ok');return;}
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
    else if(m.t==='s'&&ws.room){const r=rooms.get(ws.room);if(r){m.id=ws.id;bcast(r,m,ws);}}
  });
  ws.on('close',()=>leave(ws));ws.on('error',()=>{});
});
setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;try{ws.ping();}catch(e){}}},30000);
server.listen(PORT,()=>console.log('City Drive server on :'+PORT));
