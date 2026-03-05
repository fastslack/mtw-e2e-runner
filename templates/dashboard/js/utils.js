/* ── DOM Helpers ── */
var $=function(s){return document.querySelector(s)};
var $$=function(s){return document.querySelectorAll(s)};

function el(tag,a,ch){
  var e=document.createElement(tag);
  if(a)Object.keys(a).forEach(function(k){
    if(k==='className')e.className=a[k];
    else if(k==='style')e.style.cssText=a[k];
    else if(k.indexOf('on')===0)e.addEventListener(k.slice(2),a[k]);
    else e.setAttribute(k,a[k]);
  });
  if(typeof ch==='string')e.textContent=ch;
  else if(Array.isArray(ch))ch.forEach(function(c){if(c)e.appendChild(c)});
  return e;
}
function css(n){return n.replace(/[^a-zA-Z0-9\-_]/g,'_')}
function dur(ms){return ms>=1000?(ms/1000).toFixed(1)+'s':ms+'ms'}
function fdate(iso){return iso?new Date(iso).toLocaleString():'--'}

function prettyJson(str){
  if(!str)return '';
  try{return JSON.stringify(JSON.parse(str),null,2)}catch(e){return str}
}

function fmtHeaders(h){
  if(!h||typeof h!=='object')return '';
  return Object.keys(h).map(function(k){return k+': '+h[k]}).join('\n');
}

function buildHeaderKV(h){
  if(!h||typeof h!=='object') return el('div',{className:'rd-nd-empty'},'No data');
  var table=el('div',{className:'rd-hdr-table'});
  Object.keys(h).forEach(function(k){
    var row=el('div',{className:'rd-hdr-row'});
    row.appendChild(el('span',{className:'rd-hdr-key'},k));
    row.appendChild(el('span',{className:'rd-hdr-val'},String(h[k])));
    table.appendChild(row);
  });
  return table;
}

function makeCopyBtn(getTextFn){
  var btn=el('span',{className:'copy-btn',onclick:function(e){
    e.stopPropagation();
    var text=typeof getTextFn==='function'?getTextFn():String(getTextFn);
    navigator.clipboard.writeText(text).then(function(){
      btn.textContent='\u2713 Copied';
      btn.classList.add('copied');
      setTimeout(function(){btn.textContent='\u2398 Copy';btn.classList.remove('copied')},1200);
    });
  }},'\u2398 Copy');
  return btn;
}

function buildNdSection(title,contentEl,count,copyText){
  var toggle=el('div',{className:'rd-nd-toggle'},[
    el('span',{className:'nd-arrow'},'\u25B6'),
    el('span',null,title),
    count?el('span',{className:'nd-count'},count+' entries'):null,
    makeCopyBtn(copyText||function(){return contentWrap.textContent})
  ]);
  var contentWrap=el('div',{className:'rd-nd-content'});
  contentWrap.appendChild(contentEl);
  toggle.addEventListener('click',function(e){
    e.stopPropagation();
    toggle.classList.toggle('open');
  });
  return el('div',{className:'rd-nd-section'},[toggle,contentWrap]);
}

function gqlOp(n){
  if(n.requestBody){
    try{
      var b=JSON.parse(n.requestBody);
      if(b.operationName)return b.operationName;
      if(b.query){var m=b.query.match(/^(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/);if(m)return m[1]}
    }catch(e){}
  }
  if(n.url){
    try{var u=new URL(n.url,location.href);var op=u.searchParams.get('operationName');if(op)return op}catch(e){}
  }
  return null;
}

function buildNetRow(n){
  var mCls='rd-net-method '+(n.method||'GET').toLowerCase();
  var sCode=n.status||0;
  var sCls='rd-net-status '+(sCode<300?'s2xx':sCode<400?'s3xx':sCode<500?'s4xx':'s5xx');
  var hasDetail=n.requestBody||n.responseBody||n.requestHeaders||n.responseHeaders;
  var rowCls='rd-net-row'+(sCode>=400?' has-error':'');
  var opName=gqlOp(n);
  var children=[
    el('span',{className:'rd-net-expand'},hasDetail?'\u25B6':''),
    el('span',{className:mCls},n.method||'GET'),
    el('span',{className:sCls},String(sCode))
  ];
  if(opName)children.push(el('span',{className:'rd-net-op'},opName));
  children.push(el('span',{className:'rd-net-url'},n.url||''));
  children.push(makeCopyBtn(n.url||''));
  children.push(el('span',{className:'rd-net-dur'},dur(n.duration)));
  var row=el('div',{className:rowCls},children);
  var detail=null;
  if(hasDetail){
    var sections=[];
    if(n.requestHeaders){
      var hCount=Object.keys(n.requestHeaders).length;
      sections.push(buildNdSection('Request Headers',buildHeaderKV(n.requestHeaders),hCount,fmtHeaders(n.requestHeaders)));
    }
    if(n.requestBody){
      var rbText=prettyJson(n.requestBody);
      sections.push(buildNdSection('Request Body',el('pre',null,rbText),null,rbText));
    }
    if(n.responseHeaders){
      var rhCount=Object.keys(n.responseHeaders).length;
      sections.push(buildNdSection('Response Headers',buildHeaderKV(n.responseHeaders),rhCount,fmtHeaders(n.responseHeaders)));
    }
    if(n.responseBody){
      var respText=prettyJson(n.responseBody);
      sections.push(buildNdSection('Response Body',el('pre',null,respText),null,respText));
    }
    detail=el('div',{className:'rd-net-detail'},sections);
    row.addEventListener('click',function(e){e.stopPropagation();row.classList.toggle('open')});
  }
  return {row:row,detail:detail};
}

/* ── Screenshot hash helpers ── */
var ssHashCache={};
async function ssHash(filePath){
  if(ssHashCache[filePath])return ssHashCache[filePath];
  var data=new TextEncoder().encode(filePath);
  var buf=await crypto.subtle.digest('SHA-256',data);
  var hex=Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0')}).join('');
  var h=hex.slice(0,8);
  ssHashCache[filePath]=h;
  return h;
}
function ssHashSync(filePath){return ssHashCache[filePath]||null}
function copyHash(hash,badge){
  navigator.clipboard.writeText('ss:'+hash).then(function(){
    badge.classList.add('copied');
    setTimeout(function(){badge.classList.remove('copied')},1200);
  });
}
function createHashBadge(hash){
  var badge=el('span',{className:'ss-hash',onclick:function(e){e.stopPropagation();copyHash(hash,badge)}},[
    el('span',{className:'ss-icon'},'\u2318'),
    document.createTextNode('ss:'+hash)
  ]);
  return badge;
}

function createTriggerBadge(source){
  var s=source||'unknown';
  var labels={dashboard:'Dashboard',mcp:'MCP',cli:'CLI',unknown:'--'};
  var icons={dashboard:'\u{1F464}',mcp:'\u{1F916}',cli:'>_',unknown:'\u2022'};
  var badge=el('span',{className:'trigger-badge src-'+s},[
    el('span',{className:'trig-icon'},icons[s]||icons.unknown),
    document.createTextNode(labels[s]||s)
  ]);
  return badge;
}

/* ── Pool Distribution Summary ── */
var POOL_COLORS=['#6366f1','#22d3ee','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
function buildPoolDistribution(tests){
  var pools={};var total=0;
  Object.keys(tests).forEach(function(n){
    if(n==='__error')return;var t=tests[n];
    if(!t.poolUrl)return;
    var label=t.poolUrl.replace('ws://','').replace('wss://','');
    if(!pools[label])pools[label]={count:0,passed:0,failed:0};
    pools[label].count++;total++;
    if(t.status==='passed'||t.success)pools[label].passed++;
    if(t.status==='failed'||t.success===false)pools[label].failed++;
  });
  var keys=Object.keys(pools);
  if(keys.length<2)return null;
  var bar=el('div',{className:'pool-dist'});
  var legend=el('div',{className:'pool-dist-legend'});
  keys.forEach(function(k,i){
    var pct=Math.round(pools[k].count/total*100);
    var color=POOL_COLORS[i%POOL_COLORS.length];
    var seg=el('div',{className:'pool-dist-seg'});
    seg.style.flex=pools[k].count;seg.style.background=color;
    seg.textContent=k+' ('+pools[k].count+')';
    bar.appendChild(seg);
    var lg=el('span',{},k+': '+pools[k].count+' tests ('+pct+'%)');
    lg.style.cssText='display:inline-flex;align-items:center;gap:4px';
    var dot=el('span',{});dot.style.cssText='width:8px;height:8px;border-radius:2px;background:'+color+';flex-shrink:0';
    lg.insertBefore(dot,lg.firstChild);
    legend.appendChild(lg);
  });
  return el('div',{style:'padding:4px 12px'},[bar,legend]);
}
