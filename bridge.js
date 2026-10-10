// Loaded beside the Android-derived YouTube player on a real web origin.
(() => {
  const token=new URLSearchParams(location.search).get('bridgeToken');
  if(!token||!/^[a-f0-9]{32}$/.test(token))return;
  const actions=new Set(['tune','control','feedback','destroy']);
  const controls=new Set(['screen','picture','volume','play','pause','restart','captions','brightness','contrast','color']);
  let timer;
  const send=()=>{if(window.retro)window.parent.postMessage({channel:'plexplus-retro',token,snapshot:window.retro.snapshot()},'*');};
  window.addEventListener('message',event=>{
    const message=event.data;if(event.source!==window.parent||!message||message.channel!=='plexplus-retro'||message.token!==token||!actions.has(message.action)||!Array.isArray(message.args)||message.args.length>5||!window.retro)return;
    if(message.action==='tune'&&!/^[A-Za-z0-9_-]{11}$/.test(message.args[0]||''))return;
    if(message.action==='control'&&!controls.has(message.args[0]))return;
    if(message.action==='destroy'){clearInterval(timer);window.retro.destroy();return;}
    window.retro[message.action](...message.args);send();
  });
  timer=setInterval(send,250);send();
})();
