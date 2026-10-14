const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../bridge.js'), 'utf8');
const nonce = 'a'.repeat(32);
function harness(query = nonce) {
  let receive, tick;
  const commands = [], replies = [];
  const parent = {postMessage:(message, origin) => replies.push({message, origin})};
  const retro = {snapshot:() => ({ready:true,state:1,error:0,revision:1})};
  for (const action of ['tune','control','feedback','destroy']) retro[action] = (...args) => commands.push({action,args});
  const window = {parent,retro,addEventListener:(_,listener) => receive=listener};
  vm.runInNewContext(source,{window,location:{search:'?bridgeToken='+query},URLSearchParams,
    setInterval:listener => {tick=listener;return 1;},clearInterval:() => {tick=null;}});
  const send = (overrides={}) => receive && receive({source:parent,origin:'https://tv.example',
    data:{channel:'plexplus-retro',token:nonce,action:'tune',args:['abcdefghijk',true,1,0,false]},...overrides});
  return {send,commands,replies,parent,tick:() => tick && tick()};
}
test('no unsolicited wildcard replies before validated parent command',()=>{const h=harness();h.tick();assert.equal(h.replies.length,0);});
test('HTTPS parent replies use exact bound origin',()=>{const h=harness();h.send();assert.equal(h.commands.length,1);assert.equal(h.replies[0].origin,'https://tv.example');h.send({origin:'https://other.example'});assert.equal(h.commands.length,1);});
test('wrong source, nonce and unsupported actions never run',()=>{const h=harness();h.send({source:{}});h.send({data:{channel:'plexplus-retro',token:'bad',action:'tune',args:['abcdefghijk',true,1]}});h.send({data:{channel:'plexplus-retro',token:nonce,action:'eval',args:[]}});assert.equal(h.commands.length,0);});
test('opaque packaged TV parent stays supported without broadening HTTPS binding',()=>{const h=harness();h.send({origin:'null'});assert.equal(h.replies[0].origin,'*');h.send({origin:'https://other.example'});assert.equal(h.commands.length,1);});
test('malformed commands do not bind the parent',()=>{const h=harness();for(const args of [['bad',true,1],['abcdefghijk',true,-1],['abcdefghijk',true,1,Infinity],['abcdefghijk','true',1]])h.send({origin:'https://bad.example',data:{channel:'plexplus-retro',token:nonce,action:'tune',args}});assert.equal(h.commands.length,0);h.send();assert.equal(h.replies[0].origin,'https://tv.example');});
test('valid TV controls and feedback work; object and oversized values rejected',()=>{const h=harness();for(const [action,args] of [['control',['screen',3]],['control',['volume',50]],['control',['pause']],['feedback',['channel',12,3]]])h.send({data:{channel:'plexplus-retro',token:nonce,action,args}});assert.equal(h.commands.length,4);for(const [action,args] of [['control',['volume',{}]],['control',['picture',10]],['feedback',['input','x'.repeat(65),3]]])h.send({data:{channel:'plexplus-retro',token:nonce,action,args}});assert.equal(h.commands.length,4);});
test('invalid nonce disables bridge',()=>{const h=harness('not-a-nonce');h.send();h.tick();assert.equal(h.commands.length,0);});
