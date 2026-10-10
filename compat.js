// replaceChildren arrived after the Chromium 76 browser in 2021 Samsung TVs.
(function(){
  [Element.prototype,DocumentFragment.prototype,Document.prototype].forEach(function(prototype){
    if(!prototype.replaceChildren)prototype.replaceChildren=function(){
      var fragment=document.createDocumentFragment();
      for(var i=0;i<arguments.length;i++)fragment.appendChild(arguments[i] instanceof Node?arguments[i]:document.createTextNode(String(arguments[i])));
      while(this.firstChild)this.removeChild(this.firstChild);
      this.appendChild(fragment);
    };
  });
})();
