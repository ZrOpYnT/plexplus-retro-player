// Public player bridge: a per-frame nonce, never a Plex or account credential.
(() => {
  const token = new URLSearchParams(location.search).get('bridgeToken');
  if (!token || !/^[a-f0-9]{32}$/.test(token) || window.parent === window) return;
  const controls = new Set(['screen', 'picture', 'volume', 'play', 'pause', 'restart', 'stop', 'captions', 'brightness', 'contrast', 'color', 'aspect']);
  const feedbackKinds = new Set(['channel', 'volume', 'mute', 'input', 'signal', 'brightness', 'contrast', 'color']);
  let parentOrigin = null;
  let timer;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function valid(action, args) {
    if (!Array.isArray(args) || args.length > 5) return false;
    if (action === 'destroy') return args.length === 0;
    if (action === 'tune') return args.length >= 3 && /^[A-Za-z0-9_-]{11}$/.test(args[0]) &&
      typeof args[0] === 'string' && typeof args[1] === 'boolean' && Number.isSafeInteger(args[2]) && args[2] >= 0 &&
      (args.length < 4 || (finite(args[3]) && args[3] >= 0 && args[3] <= 86400)) &&
      (args.length < 5 || typeof args[4] === 'boolean');
    if (action === 'control') {
      if (!controls.has(args[0]) || args.length > 2) return false;
      if (['play', 'pause', 'restart', 'stop'].includes(args[0])) return args.length === 1;
      if (args.length !== 2 || !finite(args[1])) return false;
      const limits = {screen:[0,15],picture:[0,2],captions:[0,1],aspect:[100,250]};
      const range = limits[args[0]] || [0,100];
      return args[1] >= range[0] && args[1] <= range[1];
    }
    if (action === 'feedback') return args.length === 3 && feedbackKinds.has(args[0]) &&
      (typeof args[1] === 'boolean' || (finite(args[1]) && Math.abs(args[1]) <= 1000000) ||
       (typeof args[1] === 'string' && args[1].length <= 64)) && finite(args[2]) && args[2] >= 0 && args[2] <= 5;
    return false;
  }
  const send = () => {
    if (parentOrigin === null || !window.retro) return;
    // Packaged TV apps have an opaque origin ("null"), which requires '*'.
    // Never use it for ordinary HTTPS parents; bind to the first validated sender.
    window.parent.postMessage({channel:'plexplus-retro', token, snapshot:window.retro.snapshot()},
      parentOrigin === 'null' ? '*' : parentOrigin);
  };
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window.parent || !message || message.channel !== 'plexplus-retro' ||
        message.token !== token || !window.retro || !valid(message.action, message.args)) return;
    if (event.origin !== 'null' && !/^https?:\/\//.test(event.origin)) return;
    if (parentOrigin !== null && event.origin !== parentOrigin) return;
    parentOrigin = event.origin;
    if (message.action === 'destroy') { clearInterval(timer); window.retro.destroy(); return; }
    window.retro[message.action](...message.args);
    send();
  });
  timer = setInterval(send, 250);
})();
