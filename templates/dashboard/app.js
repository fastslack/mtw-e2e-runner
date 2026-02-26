(function(){
'use strict';
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
  // 1. Explicit operationName field in POST body
  if(n.requestBody){
    try{
      var b=JSON.parse(n.requestBody);
      if(b.operationName)return b.operationName;
      // 2. Parse operation name from query string: "query FooBar(...)" or "mutation FooBar(...)"
      if(b.query){var m=b.query.match(/^(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/);if(m)return m[1]}
    }catch(e){}
  }
  // 3. URL query param (GET requests or persisted queries)
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

/* ══════════════════════════════════════════════════════════════════
   Toast Notifications (Improvement 4)
   ══════════════════════════════════════════════════════════════════ */
function showToast(message,type,timeout){
  type=type||'info';
  timeout=timeout||5000;
  var container=$('#toastContainer');
  var icons={success:'\u2714',error:'\u2718',info:'\u2139'};
  var t=el('div',{className:'toast '+type},[
    el('span',null,icons[type]||''),
    el('span',null,message)
  ]);
  container.appendChild(t);
  setTimeout(function(){
    t.classList.add('fade-out');
    setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t)},300);
  },timeout);
}

function showEnrichedToast(message,type){
  var container=$('#toastContainer');
  var icons={success:'\u2714',error:'\u2718',info:'\u2139'};
  var t=el('div',{className:'toast clickable '+type,onclick:function(){showView('learnings')}},[
    el('span',null,icons[type]||''),
    el('span',null,message)
  ]);
  container.appendChild(t);
  setTimeout(function(){
    t.classList.add('fade-out');
    setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t)},300);
  },7000);
}

/* ══════════════════════════════════════════════════════════════════
   Download helper (Improvement 8)
   ══════════════════════════════════════════════════════════════════ */
function downloadFile(filename,content,mimeType){
  var blob=new Blob([content],{type:mimeType||'text/plain'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── State ── */
var S={
  ws:null,project:null,view:'suites',selectedRun:null,
  liveRuns:{},liveCollapsed:new Set(),liveSSOpen:new Set(),
  runFilter:{status:'all',search:''},
  lastLearningsData:null,
  highlightedRunIdx:-1
};

/* ── Navigation ── */
$$('.nav-item').forEach(function(n){
  n.addEventListener('click',function(){
    $$('.nav-item').forEach(function(x){x.classList.remove('active')});
    n.classList.add('active');
    S.view=n.dataset.view;
    $$('.view').forEach(function(v){v.classList.remove('active')});
    $('#view-'+S.view).classList.add('active');
  });
});
function showView(v){
  S.view=v;
  $$('.nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.view===v)});
  $$('.view').forEach(function(x){x.classList.remove('active')});
  $('#view-'+v).classList.add('active');
}

/* ══════════════════════════════════════════════════════════════════
   WebSocket
   ══════════════════════════════════════════════════════════════════ */
function connectWS(){
  var proto=location.protocol==='https:'?'wss:':'ws:';
  S.ws=new WebSocket(proto+'//'+location.host);
  S.ws.onopen=function(){
    $('#wsDot').style.background='var(--green)';$('#wsLabel').textContent='ws: connected';$('#wsLabel').style.color='var(--green)';
    showToast('WebSocket connected','info');
  };
  S.ws.onclose=function(){
    $('#wsDot').style.background='var(--red)';$('#wsLabel').textContent='ws: disconnected';$('#wsLabel').style.color='var(--text3)';
    setTimeout(connectWS,3000);
  };
  S.ws.onerror=function(){};
  S.ws.onmessage=function(e){try{handleWS(JSON.parse(e.data))}catch(x){}};
}

function getLiveRun(m){
  var rid=m.runId;if(!rid)return null;
  if(!S.liveRuns[rid])S.liveRuns[rid]={on:true,done:false,total:0,completed:0,passed:0,failed:0,active:0,tests:{},project:m.project||null,cwd:m.cwd||null,triggeredBy:m.triggeredBy||null,runId:rid,_lastEvent:Date.now()};
  S.liveRuns[rid]._lastEvent=Date.now();
  return S.liveRuns[rid];
}
function anyLiveRunning(){for(var k in S.liveRuns)if(S.liveRuns[k].on)return true;return false}

setInterval(function(){
  var changed=false;
  for(var k in S.liveRuns){
    var r=S.liveRuns[k];
    var age=Date.now()-r._lastEvent;
    if(r.on&&!r.done){
      if(r.total===0&&age>10000){r.on=false;r.done=true;r.stale=true;r.active=0;changed=true}
      else if(r.completed>=r.total&&r.total>0&&age>15000){r.on=false;r.done=true;r.active=0;changed=true}
      else if(age>30000){r.on=false;r.done=true;r.stale=true;r.active=0;changed=true}
    }
    if(r.done&&r.stale&&r.total===0&&age>15000){delete S.liveRuns[k];changed=true}
    else if(r.done&&age>120000){delete S.liveRuns[k];changed=true}
  }
  if(changed)renderLive();
},5000);

function handleWS(m){
  switch(m.event){
    case 'pool:status':renderPool(m.data);break;
    case 'run:start':
      for(var dk in S.liveRuns){if(S.liveRuns[dk].done)delete S.liveRuns[dk]}
      var r=getLiveRun(m);
      r.total=m.total;r.on=true;r.done=false;
      S.liveCollapsed=new Set();S.liveSSOpen=new Set();
      showView('live');renderLive();break;
    case 'test:start':
      var r2=getLiveRun(m);if(!r2)break;
      r2.active=m.activeCount;
      r2.tests[m.name]={status:'running',actions:0,totalActions:0,error:null,actionLog:[],screenshots:[],serial:m.serial||false};
      renderLive();break;
    case 'test:action':
      var r3=getLiveRun(m);if(!r3||!r3.tests[m.name])break;
      var t=r3.tests[m.name];
      t.actions=m.actionIndex+1;t.totalActions=m.totalActions;t.actionType=m.action.type;
      t.actionLog.push({type:m.action.type,selector:m.action.selector||null,value:m.action.value||null,text:m.action.text||null,success:m.success,duration:m.duration,error:m.error||null,narrative:m.narrative||null,actionRetries:m.action.retries||0});
      if(m.screenshotPath)t.screenshots.push(m.screenshotPath);
      renderLive();break;
    case 'test:retry':
      var r4=getLiveRun(m);if(!r4||!r4.tests[m.name])break;
      r4.tests[m.name].retry=m.attempt+'/'+m.maxAttempts;
      renderLive();break;
    case 'test:complete':
      var r5=getLiveRun(m);if(!r5)break;
      r5.completed++;
      if(m.success){r5.passed++;if(r5.tests[m.name])r5.tests[m.name].status='passed'}
      else{r5.failed++;if(r5.tests[m.name]){r5.tests[m.name].status='failed';r5.tests[m.name].error=m.error}}
      if(r5.tests[m.name]){
        r5.tests[m.name].duration=m.duration;
        if(m.screenshots&&m.screenshots.length)r5.tests[m.name].screenshots=m.screenshots;
        if(m.errorScreenshot)r5.tests[m.name].errorScreenshot=m.errorScreenshot;
        if(m.networkLogs&&m.networkLogs.length)r5.tests[m.name].networkLogs=m.networkLogs;
      }
      r5.active=Math.max(0,r5.active-1);
      renderLive();break;
    case 'run:complete':
      var r6=getLiveRun(m);if(r6){r6.on=false;r6.done=true;r6.active=0}
      var summary=m.summary||{};
      // Show basic toast immediately, then try to enrich with health data
      var baseMsg='Run complete: '+(summary.failed>0?summary.failed+' failed':'all '+(summary.total||0)+' passed');
      var baseType=summary.failed>0?'error':'success';
      // Fetch health for enrichment
      var healthUrl=S.project?'/api/db/projects/'+S.project+'/health':'/api/db/health';
      fetch(healthUrl).then(function(r){return r.json()}).then(function(h){
        if(h&&h.passRate!==undefined){
          var extra='. Pass rate: '+h.passRate+'%';
          if(h.passRateTrend==='declining')extra+=' (declining, '+h.trendDelta+'%)';
          else if(h.passRateTrend==='improving')extra+=' (improving, +'+h.trendDelta+'%)';
          if(h.flakyCount>0)extra+='. '+h.flakyCount+' flaky test(s)';
          showEnrichedToast(baseMsg+extra,baseType);
        } else {
          showToast(baseMsg,baseType);
        }
      }).catch(function(){showToast(baseMsg,baseType)});
      renderLive();refreshRuns();refreshProjects();break;
    case 'run:error':
      var r7=getLiveRun(m);if(r7){r7.on=false;r7.done=true;r7.tests.__error={status:'failed',error:m.error}}
      showToast('Run error: '+m.error,'error');
      renderLive();break;
    case 'db:updated':
      refreshRuns();refreshProjects();refreshScreenshots();refreshLearnings();break;
  }
}

/* ══════════════════════════════════════════════════════════════════
   API & Pool
   ══════════════════════════════════════════════════════════════════ */
function api(p){return fetch(p).then(function(r){return r.json()})}
function triggerRun(suite,projectId){
  if(anyLiveRunning())return;
  var body={};
  if(suite)body.suite=suite;
  if(projectId)body.projectId=projectId;
  else if(S.project)body.projectId=S.project;
  fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

function renderPool(d){
  if(!d)return;
  $('#poolDot').className='pool-dot '+(d.error||!d.available?'off':'on');
  $('#poolLabel').textContent=d.error?'offline':d.available?'ready':'busy';
  $('#poolSessions').textContent=(d.running||0)+'/'+(d.maxConcurrent||0);
}
function refreshStatus(){api('/api/status').then(function(d){renderPool(d.pool)}).catch(function(){})}

/* ══════════════════════════════════════════════════════════════════
   Projects
   ══════════════════════════════════════════════════════════════════ */
function refreshProjects(){
  api('/api/db/projects').then(function(projects){
    var sel=$('#projectSelect'),prev=sel.value;
    while(sel.options.length>1)sel.remove(1);
    if(Array.isArray(projects))projects.forEach(function(p){
      var o=document.createElement('option');o.value=p.id;o.textContent=p.name;sel.appendChild(o);
    });
    sel.value=prev||'';
  }).catch(function(){});
}
$('#projectSelect').addEventListener('change',function(){
  S.project=this.value?parseInt(this.value,10):null;
  S.selectedRun=null;
  refreshRuns();refreshSuites();refreshScreenshots();refreshLearnings();refreshVariables();
});

/* ══════════════════════════════════════════════════════════════════
   Suites (+ Serial badges, Modules)
   ══════════════════════════════════════════════════════════════════ */
function refreshSuites(){
  var grid=$('#suiteGrid'),empty=$('#suitesEmpty');
  grid.textContent='';
  var moduleSection=$('#moduleSection');
  moduleSection.textContent='';

  if(S.project){
    api('/api/db/projects/'+S.project+'/suites').then(function(suites){
      if(!Array.isArray(suites)||suites.length===0){empty.style.display='block';empty.querySelector('p').textContent='No test suites found for this project.';return}
      empty.style.display='none';
      $('#badgeSuites').textContent=suites.length;
      renderSuiteCards(grid,suites,S.project);
    }).catch(function(){});
    api('/api/db/projects/'+S.project+'/modules').then(function(modules){
      renderModules(moduleSection,modules);
    }).catch(function(){});
  } else {
    api('/api/db/projects').then(function(projects){
      if(!Array.isArray(projects)||projects.length===0){empty.style.display='block';empty.querySelector('p').textContent='No projects registered yet.';return}
      var loaded=0,hasAny=false,totalSuites=0;
      projects.forEach(function(p){
        api('/api/db/projects/'+p.id+'/suites').then(function(suites){
          loaded++;
          if(Array.isArray(suites)&&suites.length>0){
            hasAny=true;totalSuites+=suites.length;
            var label=el('div',{style:'grid-column:1/-1;font-family:var(--sans);font-size:13px;font-weight:600;margin-top:'+(grid.children.length?'16':'0')+'px;padding-bottom:6px;border-bottom:1px solid var(--border);color:var(--text2)'},p.name);
            grid.appendChild(label);
            renderSuiteCards(grid,suites,p.id);
          }
          if(loaded===projects.length){
            $('#badgeSuites').textContent=totalSuites;
            if(!hasAny){empty.style.display='block';empty.querySelector('p').textContent='No test suites found.'}
          }
        }).catch(function(){loaded++;});
      });
    }).catch(function(){});
  }
}
var _suiteCache={};
function renderSuiteCards(container,suites,projectId){
  suites.forEach(function(s){
    var tests=el('ul',{className:'suite-card-tests'});
    var pid=projectId;
    (s.tests||[]).forEach(function(t){
      var li=el('li',null,t);
      li.addEventListener('click',function(e){
        e.stopPropagation();
        var existing=li.querySelector('.suite-test-steps');
        if(existing){existing.remove();li.classList.remove('expanded');return}
        tests.querySelectorAll('.suite-test-steps').forEach(function(d){d.remove()});
        tests.querySelectorAll('li.expanded').forEach(function(l){l.classList.remove('expanded')});
        var stepsDiv=el('div',{className:'suite-test-steps'});
        stepsDiv.appendChild(el('div',{style:'color:var(--text3);font-size:10px'},'Loading...'));
        li.appendChild(stepsDiv);
        li.classList.add('expanded');
        var cacheKey=pid+'::'+s.name;
        var p=_suiteCache[cacheKey]||api('/api/db/projects/'+pid+'/suites/'+encodeURIComponent(s.name));
        _suiteCache[cacheKey]=p;
        p.then(function(data){
          stepsDiv.textContent='';
          var test=(data.tests||[]).find(function(x){return x.name===t});
          if(!test||!test.actions||!test.actions.length){
            stepsDiv.appendChild(el('div',{style:'color:var(--text3);font-size:10px'},'No actions'));
            return;
          }
          if(test.serial){
            var sb=el('span',{className:'serial-badge'},'Serial');
            li.insertBefore(sb,li.querySelector('.suite-test-steps'));
          }
          test.actions.forEach(function(a,i){
            var detail=a.selector||a.value||a.text||'';
            if(a.selector&&(a.value||a.text))detail=a.selector+' \u2192 '+(a.text||a.value);
            stepsDiv.appendChild(el('div',{className:'lt-step'},[
              el('span',{className:'step-icon',style:'color:var(--text3)'},String(i+1)),
              el('span',{className:'step-type'},a.type),
              el('span',{className:'step-detail'},detail)
            ]));
          });
        }).catch(function(){
          stepsDiv.textContent='';
          stepsDiv.appendChild(el('div',{style:'color:var(--red);font-size:10px'},'Failed to load'));
        });
      });
      tests.appendChild(li);
    });
    var card=el('div',{className:'suite-card'},[
      el('div',{className:'suite-card-head'},[
        el('div',{className:'suite-card-name'},s.name),
        el('span',{className:'suite-card-count'},s.testCount+' tests')
      ]),
      tests,
      el('button',{className:'btn sm primary',onclick:function(){triggerRun(s.name,pid)}},'Run Suite')
    ]);
    container.appendChild(card);
  });
}

function renderModules(container,modules){
  if(!Array.isArray(modules)||modules.length===0)return;
  var title=el('div',{className:'module-section-title'},[
    el('span',{className:'mod-icon'},'\u{1F9E9}'),
    document.createTextNode(' Reusable Modules ('+modules.length+')')
  ]);
  container.appendChild(title);
  var grid=el('div',{className:'module-grid'});
  modules.forEach(function(m){
    var paramsEl=null;
    if(m.params&&m.params.length){
      var items=m.params.map(function(p){return el('li',null,typeof p==='string'?p:(p.name||String(p)))});
      paramsEl=el('ul',{className:'module-card-params'},items);
    }
    var card=el('div',{className:'module-card'},[
      el('div',{className:'module-card-name'},m.name),
      m.description?el('div',{className:'module-card-desc'},m.description):null,
      el('div',{className:'module-card-meta'},[
        el('span',null,m.actionCount+' actions'),
        m.params&&m.params.length?el('span',null,m.params.length+' params'):null
      ]),
      paramsEl
    ]);
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

/* ══════════════════════════════════════════════════════════════════
   Runs (+ Filters)
   ══════════════════════════════════════════════════════════════════ */
$$('.filter-btn').forEach(function(btn){
  btn.addEventListener('click',function(){
    $$('.filter-btn').forEach(function(b){b.classList.remove('active')});
    btn.classList.add('active');
    S.runFilter.status=btn.dataset.filter;
    applyRunFilters();
  });
});
$('#runSearchInput').addEventListener('input',function(){
  S.runFilter.search=this.value.trim().toLowerCase();
  applyRunFilters();
});

var _allRunRows=[];
function applyRunFilters(){
  _allRunRows.forEach(function(item){
    var show=true;
    var r=item.data;
    if(S.runFilter.status!=='all'){
      var total=r.total||0;var passed=r.passed||0;var failed=r.failed||0;
      if(S.runFilter.status==='pass'&&(failed>0||total===0))show=false;
      if(S.runFilter.status==='fail'&&failed===0)show=false;
      if(S.runFilter.status==='mixed'&&(failed===0||passed===0))show=false;
    }
    if(show&&S.runFilter.search){
      var suite=(r.suite_name||'all').toLowerCase();
      var proj=(r.project_name||'').toLowerCase();
      if(suite.indexOf(S.runFilter.search)===-1&&proj.indexOf(S.runFilter.search)===-1)show=false;
    }
    item.tr.style.display=show?'':'none';
    if(item.detailTr)item.detailTr.style.display=show?'':'none';
  });
}

function renderRunsHealthBanner(){
  var banner=$('#runsHealthBanner');
  banner.textContent='';
  var url=S.project?'/api/db/projects/'+S.project+'/health':'/api/db/health';
  fetch(url).then(function(r){return r.json()}).then(function(h){
    if(!h||!h.passRate)return;
    var rateColor=h.passRate>=90?'green':h.passRate>=70?'amber':'red';
    var trendIcon=h.passRateTrend==='improving'?'\u25B2':h.passRateTrend==='declining'?'\u25BC':'=';
    var trendCls=h.passRateTrend==='improving'?'green':h.passRateTrend==='declining'?'red':'dim';
    var deltaStr=h.trendDelta!==0?(h.trendDelta>0?'+':'')+h.trendDelta+'%':'';

    banner.appendChild(el('div',{className:'hb-item'},[
      el('div',{className:'hb-val '+rateColor},h.passRate+'%'),
      el('div',{className:'hb-lbl'},'Pass Rate'),
      el('div',{className:'hb-trend '+trendCls},trendIcon+' '+h.passRateTrend+(deltaStr?' ('+deltaStr+')':''))
    ]));
    if(h.flakyCount>0){
      banner.appendChild(el('div',{className:'hb-item'},[
        el('div',{className:'hb-val amber'},String(h.flakyCount)),
        el('div',{className:'hb-lbl'},'Flaky Tests')
      ]));
    }
    if(h.topErrorPattern){
      var cat=h.topErrorPattern.category||h.topErrorPattern.pattern||'unknown';
      var pat=cat.replace(/-/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase()});
      banner.appendChild(el('div',{className:'hb-item'},[
        el('div',{className:'hb-val red',style:'font-size:13px'},pat),
        el('div',{className:'hb-lbl'},'Top Error ('+h.topErrorPattern.count+'x)')
      ]));
    }
    banner.appendChild(el('div',{className:'hb-link',onclick:function(){showView('learnings')}},[
      el('span',null,'\u2192 View Learnings')
    ]));
  }).catch(function(){});
}

function refreshRuns(){
  renderRunsHealthBanner();
  var url=S.project?'/api/db/projects/'+S.project+'/runs':'/api/db/runs';
  api(url).then(function(rows){
    var chart=$('#trendChart'),body=$('#runsBody'),empty=$('#runsEmpty'),head=$('#runsHead');
    chart.textContent='';body.textContent='';
    _allRunRows=[];
    S.highlightedRunIdx=-1;
    if(!Array.isArray(rows)||rows.length===0){empty.style.display='block';head.parentNode.parentNode.style.display='none';$('#badgeRuns').textContent='0';return}
    empty.style.display='none';head.parentNode.parentNode.style.display='';
    $('#badgeRuns').textContent=rows.length;

    var htr=document.createElement('tr');
    var cols=[];
    if(!S.project)cols.push('Project');
    cols=cols.concat(['Suite','Source','Date','Total','Pass','Fail','Rate','Time']);
    cols.forEach(function(c){htr.appendChild(el('th',null,c))});
    head.textContent='';head.appendChild(htr);
    var colSpan=cols.length;

    rows.slice(0,40).slice().reverse().forEach(function(r){
      var rate=parseFloat(r.pass_rate)||0;
      var color=rate>=90?'var(--green)':rate>=70?'var(--amber)':'var(--red)';
      var bar=el('div',{className:'chart-bar',style:'height:'+Math.max(rate,4)+'%;background:'+color});
      bar.appendChild(el('div',{className:'tip'},(r.project_name||'')+(r.suite_name?' / '+r.suite_name:'')+': '+r.pass_rate));
      chart.appendChild(bar);
    });

    rows.forEach(function(r){
      var tr=document.createElement('tr');
      tr.dataset.runId=r.id;
      if(r.id===S.selectedRun)tr.classList.add('expanded');
      if(!S.project)tr.appendChild(el('td',{style:'font-weight:600'},r.project_name||'-'));
      tr.appendChild(el('td',{style:'color:var(--accent)'},r.suite_name||'all'));
      var srcTd=document.createElement('td');srcTd.appendChild(createTriggerBadge(r.triggered_by));tr.appendChild(srcTd);
      tr.appendChild(el('td',null,fdate(r.generated_at)));
      tr.appendChild(el('td',null,String(r.total||0)));
      tr.appendChild(el('td',{style:'color:var(--green)'},String(r.passed||0)));
      tr.appendChild(el('td',{style:'color:var(--red)'},String(r.failed||0)));
      var rv=parseFloat(r.pass_rate)||0;
      tr.appendChild(el('td',{style:'font-weight:600;color:'+(rv>=90?'var(--green)':rv>=70?'var(--amber)':'var(--red)')},r.pass_rate||'-'));
      tr.appendChild(el('td',{style:'color:var(--text2)'},r.duration||'-'));
      tr.addEventListener('click',function(){toggleDetail(r.id,tr,colSpan)});
      body.appendChild(tr);

      var item={tr:tr,data:r,detailTr:null};
      if(r.id===S.selectedRun){
        var detailTr=createDetailRow(colSpan);
        body.appendChild(detailTr);
        loadDetailInline(r.id,detailTr);
        item.detailTr=detailTr;
      }
      _allRunRows.push(item);
    });
  }).catch(function(){});
}

function createDetailRow(colSpan){
  var detailTr=document.createElement('tr');
  detailTr.className='run-detail-row';
  var td=document.createElement('td');
  td.setAttribute('colspan',colSpan);
  var wrap=el('div',{className:'rd-wrap'});
  var inner=el('div',{className:'rd-inner'},[
    el('div',{style:'color:var(--text3);font-size:11px'},[
      el('span',{className:'spinner-small'}),
      document.createTextNode(' Loading...')
    ])
  ]);
  wrap.appendChild(inner);
  td.appendChild(wrap);
  detailTr.appendChild(td);
  return detailTr;
}

function toggleDetail(id,clickedTr,colSpan){
  if(S.selectedRun===id){
    var existing=clickedTr.nextElementSibling;
    if(existing&&existing.classList.contains('run-detail-row')){
      var w=existing.querySelector('.rd-wrap');
      if(w)w.classList.remove('open');
      clickedTr.classList.remove('expanded');
      setTimeout(function(){if(existing.parentNode)existing.parentNode.removeChild(existing)},350);
    }
    S.selectedRun=null;
    return;
  }

  var prevTr=document.querySelector('#runsBody tr.expanded');
  if(prevTr){
    prevTr.classList.remove('expanded');
    var prevDetail=prevTr.nextElementSibling;
    if(prevDetail&&prevDetail.classList.contains('run-detail-row')){
      var pw=prevDetail.querySelector('.rd-wrap');
      if(pw)pw.classList.remove('open');
      setTimeout(function(){if(prevDetail.parentNode)prevDetail.parentNode.removeChild(prevDetail)},350);
    }
  }

  S.selectedRun=id;
  clickedTr.classList.add('expanded');
  var detailTr=createDetailRow(colSpan);
  clickedTr.parentNode.insertBefore(detailTr,clickedTr.nextSibling);
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      var w2=detailTr.querySelector('.rd-wrap');
      if(w2)w2.classList.add('open');
    });
  });
  loadDetailInline(id,detailTr);
}

/* ══════════════════════════════════════════════════════════════════
   Run Detail (+ Action Narratives, Retry badges, Export)
   ══════════════════════════════════════════════════════════════════ */
function loadDetailInline(id,detailTr){
  api('/api/db/runs/'+id).then(function(d){
    if(d.error)return;
    var inner=detailTr.querySelector('.rd-inner');
    inner.textContent='';
    var results=d.results||[];

    var exportBtn=el('div',null,[
      el('div',{className:'rd-s-label'},'Export'),
      el('div',{style:'margin-top:4px'},[
        el('button',{className:'btn sm',onclick:function(e){
          e.stopPropagation();
          downloadFile('run-'+id+'.json',JSON.stringify(d,null,2),'application/json');
        }},'JSON')
      ])
    ]);
    var srcBlock=el('div',null,[el('div',{className:'rd-s-label'},'Source'),el('div',{style:'margin-top:4px'},[createTriggerBadge(d.triggeredBy)])]);
    var summ=el('div',{className:'rd-summary'},[
      el('div',null,[el('div',{className:'rd-s-label'},'Suite'),el('div',{className:'rd-s-val',style:'font-size:14px;color:var(--accent)'},d.suiteName||'all')]),
      srcBlock,
      el('div',null,[el('div',{className:'rd-s-label'},'Total'),el('div',{className:'rd-s-val'},String(d.summary.total))]),
      el('div',null,[el('div',{className:'rd-s-label'},'Passed'),el('div',{className:'rd-s-val',style:'color:var(--green)'},String(d.summary.passed))]),
      el('div',null,[el('div',{className:'rd-s-label'},'Failed'),el('div',{className:'rd-s-val',style:'color:'+(d.summary.failed>0?'var(--red)':'var(--text3)')},String(d.summary.failed))]),
      el('div',null,[el('div',{className:'rd-s-label'},'Duration'),el('div',{className:'rd-s-val',style:'font-size:14px;color:var(--text2)'},d.summary.duration||'-')]),
      exportBtn
    ]);
    inner.appendChild(summ);

    // Fetch and render insights (async, non-blocking)
    var insightsContainer=el('div',{className:'rd-insights'});
    inner.appendChild(insightsContainer);
    fetch('/api/db/runs/'+id+'/insights').then(function(r){return r.json()}).then(function(ins){
      if(!ins||ins.error)return;
      var items=[];
      var h=ins.health;
      if(h){
        var rateColor=h.passRate>=90?'green':h.passRate>=70?'amber':'red';
        var trendIcon=h.passRateTrend==='improving'?'\u25B2':h.passRateTrend==='declining'?'\u25BC':'=';
        var trendCls=h.passRateTrend==='improving'?'green':h.passRateTrend==='declining'?'red':'';
        items.push(el('div',{className:'rd-ins-health'},[
          el('span',{className:'rd-ins-rate '+rateColor},h.passRate+'%'),
          el('span',{className:'rd-ins-trend '+trendCls},trendIcon+' '+h.passRateTrend),
          h.flakyCount>0?el('span',{className:'rd-ins-tag amber'},h.flakyCount+' flaky'):null,
          h.unstableSelectorCount>0?el('span',{className:'rd-ins-tag red'},h.unstableSelectorCount+' unstable sel.'):null
        ]));
      }
      var insights=ins.insights||[];
      insights.forEach(function(i){
        var icon=i.type==='new-failure'?'\u2718':i.type==='recovered'?'\u2714':i.type==='flaky'?'\u223C':'!';
        var cls=i.type==='new-failure'?'red':i.type==='recovered'?'green':i.type==='flaky'?'amber':'';
        items.push(el('div',{className:'rd-ins-item '+cls},[
          el('span',{className:'rd-ins-icon'},icon),
          el('span',null,i.message)
        ]));
      });
      if(items.length>0){
        items.forEach(function(it){insightsContainer.appendChild(it)});
      } else {
        insightsContainer.style.display='none';
      }
    }).catch(function(){insightsContainer.style.display='none'});

    results.forEach(function(r){
      var d2=r.durationMs?dur(r.durationMs):r.endTime&&r.startTime?dur(new Date(r.endTime)-new Date(r.startTime)):'-';
      var flaky=r.success&&r.attempt>1;
      var state=flaky?'flaky':(r.success?'pass':'fail');

      var badges=el('div',{style:'display:flex;gap:6px;align-items:center;flex-shrink:0'});
      badges.appendChild(el('span',{className:'badge '+(r.success?'pass':'fail')},r.success?'PASS':'FAIL'));
      if(flaky)badges.appendChild(el('span',{className:'badge flaky'},'FLAKY'));

      var head=el('div',{className:'rd-test-head'},[badges,el('div',{className:'rd-test-name'},r.name),el('div',{className:'rd-test-dur'},d2)]);
      var body=el('div',{className:'rd-test-body'});

      if(r.maxAttempts>1){body.appendChild(el('div',{className:'rd-retries'},'Attempt '+r.attempt+' of '+r.maxAttempts))}
      if(r.error){
        var errDiv=el('div',{className:'rd-error-msg'});
        errDiv.appendChild(document.createTextNode(r.error));
        errDiv.appendChild(makeCopyBtn(r.error));
        body.appendChild(errDiv);
      }

      // Actions panel
      if(r.actions&&r.actions.length){
        var passCount=r.actions.filter(function(a){return a.success}).length;
        var failCount=r.actions.length-passCount;
        var actHead=el('div',{className:'rd-net-head'},[
          el('span',{className:'net-arrow'},'\u25B6'),
          el('span',{className:'net-title'},'Actions'),
          el('div',{className:'net-stats'},[
            el('span',{className:'net-stat'},[document.createTextNode('Steps: '),el('strong',null,String(r.actions.length))]),
            failCount?el('span',{className:'net-stat has-err'},[document.createTextNode('Failed: '),el('strong',null,String(failCount))]):null
          ])
        ]);
        var actBody=el('div',{className:'rd-net-body',style:'padding:8px 14px'});
        r.actions.forEach(function(a){
          var label=a.narrative||a.type;
          var durText=a.duration!=null?dur(a.duration):'';
          var retryBadge=null;
          if(a.actionRetries&&a.actionRetries>0){
            retryBadge=el('span',{className:'badge flaky',style:'font-size:9px;padding:1px 5px'},'\u21BB x'+a.actionRetries);
          }
          actBody.appendChild(el('div',{className:'lt-step'},[
            el('span',{className:'step-icon '+(a.success?'ok':'fail')},a.success?'\u2714':'\u2718'),
            el('span',{className:'step-detail',style:'flex:1'},label),
            retryBadge,
            el('span',{className:'step-dur'},durText)
          ]));
        });
        actHead.addEventListener('click',function(){actHead.classList.toggle('open')});
        body.appendChild(el('div',{className:'rd-net-panel'},[actHead,actBody]));
      }

      // Screenshots
      var shots=[];
      var hashes=r.screenshotHashes||{};
      (r.screenshots||[]).forEach(function(p){shots.push({path:p,label:p.split('/').pop(),type:'screenshot',hash:hashes[p]||null})});
      if(r.errorScreenshot){shots.push({path:r.errorScreenshot,label:r.errorScreenshot.split('/').pop(),type:'error',hash:hashes[r.errorScreenshot]||null})}
      if(shots.length){
        var shotsWrap=el('div',{className:'rd-shots'});
        shots.forEach(function(s){
          var src='/api/image?path='+encodeURIComponent(s.path);
          var img=document.createElement('img');img.src=src;img.alt=s.label;img.loading='lazy';
          var capEl=el('div',{className:'rd-shot-cap'},[el('span',{className:'cap-name'},s.label)]);
          if(s.hash){capEl.appendChild(createHashBadge(s.hash))}
          else{(function(c,fp){ssHash(fp).then(function(h){c.appendChild(createHashBadge(h))})})(capEl,s.path)}
          shotsWrap.appendChild(el('div',{className:'rd-shot'+(s.type==='error'?' err-shot':''),onclick:function(e){e.stopPropagation();openModal(src)}},[img,capEl]));
        });
        body.appendChild(shotsWrap);
      }

      // Console logs
      var cIssues=(r.consoleLogs||[]).filter(function(l){return l.type==='error'||l.type==='warn'||l.type==='warning'});
      if(cIssues.length){
        var cErrors=cIssues.filter(function(l){return l.type==='error'}).length;
        var cWarns=cIssues.length-cErrors;
        var conHead=el('div',{className:'rd-net-head'},[
          el('span',{className:'net-arrow'},'\u25B6'),
          el('span',{className:'net-title'},'Console'),
          el('div',{className:'net-stats'},[
            cErrors?el('span',{className:'net-stat has-err'},[document.createTextNode('Errors: '),el('strong',null,String(cErrors))]):null,
            cWarns?el('span',{className:'net-stat'},[document.createTextNode('Warnings: '),el('strong',null,String(cWarns))]):null
          ]),
          makeCopyBtn(function(){return cIssues.map(function(l){return '['+l.type+'] '+l.text}).join('\n')})
        ]);
        var conBody=el('div',{className:'rd-net-body'});
        cIssues.forEach(function(l){conBody.appendChild(el('div',{className:'rd-log-item '+l.type},'['+l.type+'] '+l.text))});
        conHead.addEventListener('click',function(){conHead.classList.toggle('open')});
        body.appendChild(el('div',{className:'rd-net-panel'},[conHead,conBody]));
      }

      // Network errors
      if(r.networkErrors&&r.networkErrors.length){
        var neHead=el('div',{className:'rd-net-head'},[
          el('span',{className:'net-arrow'},'\u25B6'),
          el('span',{className:'net-title'},'Network Errors'),
          el('div',{className:'net-stats'},[el('span',{className:'net-stat has-err'},[document.createTextNode('Errors: '),el('strong',null,String(r.networkErrors.length))])]),
          makeCopyBtn(function(){return r.networkErrors.map(function(ne){return '['+ne.error+'] '+ne.url}).join('\n')})
        ]);
        var neBody=el('div',{className:'rd-net-body'});
        r.networkErrors.forEach(function(ne){neBody.appendChild(el('div',{className:'rd-log-item error'},'['+ne.error+'] '+ne.url))});
        neHead.addEventListener('click',function(){neHead.classList.toggle('open')});
        body.appendChild(el('div',{className:'rd-net-panel'},[neHead,neBody]));
      }

      // Network panel
      if(r.networkLogs&&r.networkLogs.length){
        var errCount=r.networkLogs.filter(function(n){return n.status>=400}).length;
        var netHead=el('div',{className:'rd-net-head'},[
          el('span',{className:'net-arrow'},'\u25B6'),
          el('span',{className:'net-title'},'Network Requests'),
          el('div',{className:'net-stats'},[
            el('span',{className:'net-stat'},[document.createTextNode('Total: '),el('strong',null,String(r.networkLogs.length))]),
            errCount?el('span',{className:'net-stat has-err'},[document.createTextNode('Errors: '),el('strong',null,String(errCount))]):null
          ])
        ]);
        var netCols=el('div',{className:'rd-net-cols'},[el('span',{className:'col-e'},''),el('span',{className:'col-m'},'Method'),el('span',{className:'col-s'},'Status'),el('span',{className:'col-u'},'URL'),el('span',{className:'col-d'},'Time')]);
        var netBody=el('div',{className:'rd-net-body'},[netCols]);
        r.networkLogs.forEach(function(n){var built=buildNetRow(n);netBody.appendChild(built.row);if(built.detail)netBody.appendChild(built.detail)});
        netHead.addEventListener('click',function(){netHead.classList.toggle('open')});
        body.appendChild(el('div',{className:'rd-net-panel'},[netHead,netBody]));
      }

      inner.appendChild(el('div',{className:'rd-test '+state},[head,body]));
    });

    var w=detailTr.querySelector('.rd-wrap');
    if(w&&!w.classList.contains('open')){requestAnimationFrame(function(){w.classList.add('open')})}
  }).catch(function(){
    var inner=detailTr.querySelector('.rd-inner');
    if(inner)inner.textContent='Failed to load run detail';
  });
}

/* ══════════════════════════════════════════════════════════════════
   Screenshots
   ══════════════════════════════════════════════════════════════════ */
function refreshScreenshots(){
  var gal=$('#screenshotGallery'),empty=$('#screenshotsEmpty');
  gal.textContent='';
  if(!S.project){empty.style.display='block';empty.querySelector('p').textContent='Select a project to view screenshots.';$('#badgeScreenshots').textContent='-';return}
  api('/api/db/projects/'+S.project+'/screenshots').then(function(files){
    if(!Array.isArray(files)||!files.length){empty.style.display='block';empty.querySelector('p').textContent='No screenshots for this project.';$('#badgeScreenshots').textContent='0';return}
    empty.style.display='none';
    $('#badgeScreenshots').textContent=files.length;
    files.forEach(function(f){
      var src='/api/image?path='+encodeURIComponent(f.path);
      var img=document.createElement('img');img.src=src;img.alt=f.name;img.loading='lazy';
      var capEl=el('div',{className:'cap'},[el('span',{className:'cap-name'},f.name)]);
      (function(c,fp){ssHash(fp).then(function(h){c.appendChild(createHashBadge(h))})})(capEl,f.path);
      gal.appendChild(el('div',{className:'gallery-item',onclick:function(){openModal(src)}},[img,capEl]));
    });
  }).catch(function(){});
}

function searchByHash(){
  var container=$('#ssSearchResult');
  container.textContent='';
  var raw=$('#ssHashInput').value.trim();
  if(!raw)return;
  var hash=raw.replace(/^ss:/,'');
  if(!/^[a-f0-9]{1,8}$/i.test(hash)){
    container.appendChild(el('div',{className:'ss-search-error'},'Invalid hash format. Expected 8 hex characters (e.g. ss:a3f2b1c9).'));
    return;
  }
  fetch('/api/screenshot-hash/'+hash).then(function(res){
    if(!res.ok){container.appendChild(el('div',{className:'ss-search-error'},'Screenshot not found for hash: ss:'+hash));return}
    return res.blob();
  }).then(function(blob){
    if(!blob)return;
    var url=URL.createObjectURL(blob);
    var wrap=el('div',{className:'ss-search-result'},[el('div',{className:'ss-result-label'},[createHashBadge(hash),el('span',{},'Found')])]);
    var img=document.createElement('img');img.src=url;img.alt='ss:'+hash;
    img.addEventListener('click',function(){openModal(url)});
    wrap.appendChild(img);
    container.appendChild(wrap);
  }).catch(function(){container.appendChild(el('div',{className:'ss-search-error'},'Error searching for screenshot.'))});
}
$('#ssHashBtn').addEventListener('click',searchByHash);
$('#ssHashInput').addEventListener('keydown',function(e){if(e.key==='Enter')searchByHash()});

/* ══════════════════════════════════════════════════════════════════
   Live Execution (+ Retry badges, Serial badges)
   ══════════════════════════════════════════════════════════════════ */
function clearFinishedLiveRuns(){for(var k in S.liveRuns){if(S.liveRuns[k].done||!S.liveRuns[k].on)delete S.liveRuns[k]}renderLive()}
function dismissLiveRun(rid){delete S.liveRuns[rid];renderLive()}
$('#liveClearBtn').addEventListener('click',clearFinishedLiveRuns);

function renderLive(){
  var panel=$('#livePanel'),grid=$('#liveTests'),navLive=$('#navLive'),liveEmpty=$('#liveEmpty');
  var runs=S.liveRuns;var runIds=Object.keys(runs);

  if(runIds.length===0){panel.classList.remove('active');navLive.style.display='none';liveEmpty.style.display='block';$('#liveClearBtn').style.display='none';return}

  navLive.style.display='';liveEmpty.style.display='none';panel.classList.add('active');

  var gTotal=0,gCompleted=0,gPassed=0,gFailed=0,gActive=0,gRunning=false,gDone=true;
  runIds.forEach(function(rid){var r=runs[rid];gTotal+=r.total;gCompleted+=r.completed;gPassed+=r.passed;gFailed+=r.failed;gActive+=r.active;if(r.on)gRunning=true;if(!r.done)gDone=false});

  var badgeActive=0;
  runIds.forEach(function(rid){var r=runs[rid];Object.keys(r.tests).forEach(function(n){if(n!=='__error'&&r.tests[n].status==='running')badgeActive++})});
  $('#liveBadge').textContent=gRunning?badgeActive:gCompleted;
  $('#liveBadge').style.background=gRunning?'var(--purple-dim)':gFailed>0?'var(--red-dim)':'var(--green-dim)';
  $('#liveBadge').style.color=gRunning?'var(--purple)':gFailed>0?'var(--red)':'var(--green)';

  $('#liveTotal').textContent=gTotal;$('#livePass').textContent=gPassed;$('#liveFail').textContent=gFailed;$('#liveActive').textContent=gActive;
  $('#liveProgressFill').style.width=(gTotal>0?gCompleted/gTotal*100:0)+'%';
  $('#liveProject').style.display='none';

  var hasFinished=runIds.some(function(rid){return runs[rid].done||!runs[rid].on});
  $('#liveClearBtn').style.display=hasFinished?'inline-block':'none';

  var lbl=panel.querySelector('.live-header .label');
  var anyStale=runIds.some(function(rid){return runs[rid].stale});
  if(!gRunning&&gDone){
    lbl.textContent=anyStale?'COMPLETED (connection lost)':gFailed>0?'COMPLETED WITH FAILURES':'ALL TESTS PASSED';
    lbl.style.color=anyStale?'var(--yellow)':gFailed>0?'var(--red)':'var(--green)';
    var dot=lbl.querySelector('.dot');if(dot)dot.remove();
    $('#liveProgressFill').style.background=anyStale?'var(--yellow)':gFailed>0?'var(--red)':'var(--green)';
  } else {
    if(!lbl.querySelector('.dot')){lbl.textContent='';var d=el('span',{className:'dot'});lbl.appendChild(d);lbl.appendChild(document.createTextNode(' RUNNING'))}
    lbl.style.color='var(--purple)';$('#liveProgressFill').style.background='var(--purple)';
  }

  grid.textContent='';
  runIds.forEach(function(rid){
    var L=runs[rid];
    var projLabel=L.project||(L.cwd?L.cwd.split('/').pop():'Run');
    var runStatus=L.done?(L.failed>0?'fail':'pass'):'running';
    var dismissBtn=null;
    if(L.done||!L.on){dismissBtn=el('button',{className:'lr-dismiss',onclick:function(e){e.stopPropagation();dismissLiveRun(rid)}},'\u2715')}
    grid.appendChild(el('div',{className:'lr-section-header '+runStatus},[
      el('span',{className:'lr-project-name'},projLabel),createTriggerBadge(L.triggeredBy),
      el('span',{className:'lr-section-stats'},[el('span',{},L.completed+'/'+L.total),L.failed>0?el('span',{style:'color:var(--red);margin-left:6px'},L.failed+' failed'):null,L.on?el('span',{className:'spinner-small',style:'margin-left:6px'}):null]),
      dismissBtn
    ]));

    var testGrid=el('div',{className:'lr-test-grid'});
    Object.keys(L.tests).forEach(function(name){
      if(name==='__error')return;
      var t=L.tests[name];var testKey=rid+'::'+name;
      var iconText=t.status==='passed'?'\u2714':t.status==='failed'?'\u2718':'\u25CF';
      var iconColor=t.status==='passed'?'color:var(--green)':t.status==='failed'?'color:var(--red)':'color:var(--purple)';
      var meta='';
      if(t.status==='running'){meta=t.actionType?('Step '+(t.actions||0)+'/'+(t.totalActions||'?')):'starting...';if(t.retry)meta='Retry '+t.retry}
      else if(t.status==='passed'){meta=t.duration||'done'}
      else if(t.status==='failed'){meta=t.error||'failed'}

      var stepsEl=el('div',{className:'lt-actions'});
      if(t.actionLog&&t.actionLog.length>0){
        t.actionLog.forEach(function(a){
          var detail=a.narrative||a.selector||a.value||a.text||'';
          var durText=a.duration!=null?(a.duration<1000?a.duration+'ms':(a.duration/1000).toFixed(1)+'s'):'';
          var retryBadge=null;
          if(a.actionRetries&&a.actionRetries>0){retryBadge=el('span',{className:'badge flaky',style:'font-size:9px;padding:1px 5px;margin-left:4px'},'\u21BB x'+a.actionRetries)}
          stepsEl.appendChild(el('div',{className:'lt-step'},[
            el('span',{className:'step-icon '+(a.success?'ok':'fail')},a.success?'\u2714':'\u2718'),
            el('span',{className:'step-type'},a.type),
            el('span',{className:'step-detail'},detail),
            retryBadge,
            el('span',{className:'step-dur'},durText)
          ]));
        });
        if(t.status==='running'&&t.actions<t.totalActions){stepsEl.appendChild(el('div',{className:'lt-step'},[el('span',{className:'step-icon run spinner-small'}),el('span',{className:'step-type',style:'opacity:.6'},'waiting...')]))}
      } else if(t.status==='running'){
        stepsEl.appendChild(el('div',{className:'lt-step'},[el('span',{className:'step-icon run spinner-small'}),el('span',{className:'step-type',style:'opacity:.6'},'connecting...')]));
      }
      var isFinished=t.status==='passed'||t.status==='failed';
      var isCollapsed=isFinished&&S.liveCollapsed.has(testKey);
      var summaryEl=el('div',{className:'lt-summary'},[el('span',{className:'lt-dur'},t.duration||''),el('span',{className:'lt-expand'},isCollapsed?'\u25BC':'\u25B2')]);

      var ssEl=null;
      var allSS=(t.screenshots||[]).slice();
      if(t.errorScreenshot)allSS.push(t.errorScreenshot);
      if(allSS.length>0){
        var ssOpen=S.liveSSOpen&&S.liveSSOpen.has(testKey);
        var toggle=el('div',{className:'lt-screenshots-toggle'+(ssOpen?' open':'')},[el('span',{className:'ss-arrow'},'\u25B6'),el('span',{},'Screenshots ('+allSS.length+')')]);
        var ssGridEl=el('div',{className:'lt-screenshots-grid'});
        allSS.forEach(function(ssPath){
          var fname=ssPath.split('/').pop();var isErr=t.errorScreenshot&&ssPath===t.errorScreenshot;
          var thumb=el('div',{className:'lt-ss-thumb'});
          var img=document.createElement('img');img.src='/api/image?path='+encodeURIComponent(ssPath);img.alt=fname;img.loading='lazy';
          if(isErr)thumb.style.borderColor='var(--red)';
          thumb.appendChild(img);
          thumb.addEventListener('click',function(e){e.stopPropagation();openModal('/api/image?path='+encodeURIComponent(ssPath),fname)});
          var labelEl=el('div',{className:'lt-ss-label'},[el('span',{style:'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'},fname)]);
          (function(lbl,sp){ssHash(sp).then(function(h){lbl.appendChild(createHashBadge(h))})})(labelEl,ssPath);
          ssGridEl.appendChild(el('div',{},[thumb,labelEl]));
        });
        toggle.addEventListener('click',function(e){e.stopPropagation();if(S.liveSSOpen.has(testKey))S.liveSSOpen.delete(testKey);else S.liveSSOpen.add(testKey);toggle.classList.toggle('open');ssGridEl.style.display=ssGridEl.style.display==='grid'?'none':'grid'});
        if(ssOpen)ssGridEl.style.display='grid';
        ssEl=el('div',{className:'lt-screenshots'},[toggle,ssGridEl]);
      }

      var serialBadge=t.serial?el('span',{className:'serial-badge'},'Serial'):null;
      var card=el('div',{className:'live-test '+t.status+(isCollapsed?' collapsed':'')},[
        el('div',{className:'lt-name'},[
          t.status==='running'?el('span',{className:'spinner'}):el('span',{className:'lt-icon',style:iconColor},iconText),
          document.createTextNode(' '+name),serialBadge,summaryEl
        ]),
        el('div',{className:'lt-meta'},meta),stepsEl
      ]);
      if(ssEl)card.appendChild(ssEl);
      if(t.networkLogs&&t.networkLogs.length&&!isCollapsed){
        var liveErrCount=t.networkLogs.filter(function(n){return n.status>=400}).length;
        var liveNetHead=el('div',{className:'rd-net-head'},[el('span',{className:'net-arrow'},'\u25B6'),el('span',{className:'net-title'},'Network Requests'),el('div',{className:'net-stats'},[el('span',{className:'net-stat'},[document.createTextNode('Total: '),el('strong',null,String(t.networkLogs.length))]),liveErrCount?el('span',{className:'net-stat has-err'},[document.createTextNode('Errors: '),el('strong',null,String(liveErrCount))]):null])]);
        var liveNetCols=el('div',{className:'rd-net-cols'},[el('span',{className:'col-e'},''),el('span',{className:'col-m'},'Method'),el('span',{className:'col-s'},'Status'),el('span',{className:'col-u'},'URL'),el('span',{className:'col-d'},'Time')]);
        var liveNetBody=el('div',{className:'rd-net-body'},[liveNetCols]);
        t.networkLogs.forEach(function(n){var built=buildNetRow(n);liveNetBody.appendChild(built.row);if(built.detail)liveNetBody.appendChild(built.detail)});
        liveNetHead.addEventListener('click',function(e){e.stopPropagation();liveNetHead.classList.toggle('open')});
        card.appendChild(el('div',{className:'rd-net-panel',style:'margin-top:6px'},[liveNetHead,liveNetBody]));
      }
      if(isFinished){card.addEventListener('click',function(e){if(window.getSelection().toString())return;if(S.liveCollapsed.has(testKey))S.liveCollapsed.delete(testKey);else S.liveCollapsed.add(testKey);renderLive()})}
      testGrid.appendChild(card);
      if(!isCollapsed)stepsEl.scrollTop=stepsEl.scrollHeight;
    });
    grid.appendChild(testGrid);
  });
}

$('#btnRunAll').addEventListener('click',function(){triggerRun()});

/* ── Modal ── */
function openModal(src){$('#modalImg').src=src;$('#modal').classList.add('open')}
$('#modal').addEventListener('click',function(){$('#modal').classList.remove('open')});

/* ══════════════════════════════════════════════════════════════════
   Learnings (+ Cross-project, Export)
   ══════════════════════════════════════════════════════════════════ */
function refreshLearnings(){
  var days=$('#learningsDays').value||30;
  var url=S.project?'/api/db/projects/'+S.project+'/learnings?days='+days:'/api/db/learnings?days='+days;
  fetch(url).then(function(r){return r.json()}).then(function(data){
    if(!data||data.totalRuns===0){
      $('#learningsEmpty').style.display='block';
      $('#learningsOverview').textContent='';$('#learningsTrend').textContent='';
      $('#learningsFlaky').textContent='';$('#learningsSelectors').textContent='';
      $('#learningsPages').textContent='';$('#learningsApis').textContent='';
      $('#learningsErrors').textContent='';
      $('#badgeLearnings').textContent='-';
      return;
    }
    $('#learningsEmpty').style.display='none';
    S.lastLearningsData=data;
    var flakyCount=data.flakyTests?data.flakyTests.length:0;
    var passRate=data.overallPassRate||0;
    // Semaphore badge: red (< 70%), amber (flaky or declining), green (healthy)
    var declining=data.recentTrend&&Array.isArray(data.recentTrend.data||data.recentTrend)&&(function(){
      var td=data.recentTrend.data||data.recentTrend;
      if(td.length<2)return false;
      var last=td[td.length-1].pass_rate;
      var prior=td.slice(0,-1).reduce(function(s,t){return s+t.pass_rate},0)/(td.length-1);
      return last-prior<-2;
    })();
    if(passRate<70){
      $('#badgeLearnings').textContent='\u26A0';
      $('#badgeLearnings').style.background='var(--red-dim)';$('#badgeLearnings').style.color='var(--red)';
    } else if(flakyCount>0||declining){
      $('#badgeLearnings').textContent=flakyCount>0?flakyCount:(declining?'\u25BC':'\u2714');
      $('#badgeLearnings').style.background='var(--amber-dim)';$('#badgeLearnings').style.color='var(--amber)';
    } else {
      $('#badgeLearnings').textContent='\u2714';
      $('#badgeLearnings').style.background='var(--green-dim)';$('#badgeLearnings').style.color='var(--green)';
    }
    renderLearnOverview(data);
    renderLearnTrend(data.recentTrend||[]);
    renderLearnFlaky(data.flakyTests||[]);
    renderLearnSelectors(data.unstableSelectors||[]);
    renderLearnPages(data.failingPages||[]);
    renderLearnApis(data.apiIssues||[]);
    renderLearnErrors(data.topErrors||[]);
  }).catch(function(){$('#learningsEmpty').style.display='block'});
}

function renderLearnOverview(d){
  var container=$('#learningsOverview');container.textContent='';
  var grid=document.createElement('div');grid.className='learn-grid';
  [{val:d.totalRuns,lbl:'Runs',cls:'accent'},{val:d.totalTests,lbl:'Tests',cls:'accent'},
   {val:d.overallPassRate+'%',lbl:'Pass Rate',cls:d.overallPassRate>=90?'green':d.overallPassRate>=70?'':'red'},
   {val:d.avgDurationMs<1000?d.avgDurationMs+'ms':(d.avgDurationMs/1000).toFixed(1)+'s',lbl:'Avg Duration',cls:'purple'},
   {val:(d.flakyTests?d.flakyTests.length:0),lbl:'Flaky Tests',cls:d.flakyTests&&d.flakyTests.length>0?'red':'green'},
   {val:(d.unstableSelectors?d.unstableSelectors.length:0),lbl:'Unstable Selectors',cls:d.unstableSelectors&&d.unstableSelectors.length>0?'red':'green'}
  ].forEach(function(item){
    var stat=document.createElement('div');stat.className='learn-stat';
    var valEl=document.createElement('div');valEl.className='learn-stat-val '+item.cls;valEl.textContent=item.val;
    var lblEl=document.createElement('div');lblEl.className='learn-stat-lbl';lblEl.textContent=item.lbl;
    stat.appendChild(valEl);stat.appendChild(lblEl);grid.appendChild(stat);
  });
  container.appendChild(grid);
}

function renderLearnTrend(trend){
  var container=$('#learningsTrend');container.textContent='';
  if(!trend.length)return;
  var card=document.createElement('div');card.className='card';
  var label=document.createElement('div');label.className='card-label';label.textContent='Pass Rate Trend (7 days)';card.appendChild(label);
  var chartDiv=document.createElement('div');chartDiv.className='learn-trend-chart';
  var w=100/trend.length;var ns='http://www.w3.org/2000/svg';
  var svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none');
  var bg=document.createElementNS(ns,'rect');bg.setAttribute('x','0');bg.setAttribute('y','0');bg.setAttribute('width','100');bg.setAttribute('height','100');bg.setAttribute('fill','var(--surface2)');bg.setAttribute('rx','2');
  svg.appendChild(bg);
  var gridLine=document.createElementNS(ns,'line');gridLine.setAttribute('x1','0');gridLine.setAttribute('y1','50');gridLine.setAttribute('x2','100');gridLine.setAttribute('y2','50');gridLine.setAttribute('stroke','var(--border)');gridLine.setAttribute('stroke-width','0.3');gridLine.setAttribute('stroke-dasharray','2,2');svg.appendChild(gridLine);
  var pts=trend.map(function(t,i){return(i*w+w/2)+','+(100-t.pass_rate)}).join(' ');
  var poly=document.createElementNS(ns,'polygon');poly.setAttribute('points',(0*w+w/2)+',100 '+pts+' '+((trend.length-1)*w+w/2)+',100');poly.setAttribute('fill','var(--accent-dim)');svg.appendChild(poly);
  var pl=document.createElementNS(ns,'polyline');pl.setAttribute('points',pts);pl.setAttribute('fill','none');pl.setAttribute('stroke','var(--accent)');pl.setAttribute('stroke-width','1.5');svg.appendChild(pl);
  trend.forEach(function(t,i){
    var circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',''+(i*w+w/2));circle.setAttribute('cy',''+(100-t.pass_rate));circle.setAttribute('r','2');circle.setAttribute('fill','var(--accent)');
    var title=document.createElementNS(ns,'title');title.textContent=t.date+': '+t.pass_rate+'% ('+t.total_tests+' tests)';circle.appendChild(title);svg.appendChild(circle);
  });
  chartDiv.appendChild(svg);card.appendChild(chartDiv);
  var dates=document.createElement('div');dates.style.cssText='display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px';
  dates.appendChild(el('span',null,trend[0].date));dates.appendChild(el('span',null,trend[trend.length-1].date));
  card.appendChild(dates);container.appendChild(card);
}

function buildLearnTable(title,headers,rows){
  var card=document.createElement('div');card.className='card learn-section';
  var h=document.createElement('div');h.className='learn-section-title';h.textContent=title;card.appendChild(h);
  var wrap=document.createElement('div');wrap.className='tbl-wrap';
  var tbl=document.createElement('table');tbl.className='learn-table';
  var thead=document.createElement('thead');var hr=document.createElement('tr');
  headers.forEach(function(hdr){var th=document.createElement('th');th.textContent=hdr;hr.appendChild(th)});
  thead.appendChild(hr);tbl.appendChild(thead);
  var tbody=document.createElement('tbody');
  rows.forEach(function(cells){
    var tr=document.createElement('tr');
    cells.forEach(function(cell){
      var td=document.createElement('td');
      if(cell.code){var code=document.createElement('code');code.textContent=cell.code;td.appendChild(code)}
      else if(cell.badge){var span=document.createElement('span');span.className='badge '+cell.cls;span.textContent=cell.badge;td.appendChild(span)}
      else{td.textContent=cell.text!==undefined&&cell.text!==null?cell.text:(typeof cell==='object'?'-':cell)}
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);wrap.appendChild(tbl);card.appendChild(wrap);return card;
}

function renderLearnFlaky(flaky){var c=$('#learningsFlaky');c.textContent='';if(!flaky.length)return;c.appendChild(buildLearnTable('Flaky Tests',['Test','Flaky Rate','Occurrences','Total Runs','Last Flaky','Avg Attempts'],flaky.map(function(f){return[{code:f.test_name},{badge:f.flaky_rate+'%',cls:f.flaky_rate>30?'fail':'flaky'},{text:f.flaky_count},{text:f.total_runs},{text:(f.last_flaky||'-').split('T')[0]},{text:f.avg_attempts}]})))}
function renderLearnSelectors(sels){var c=$('#learningsSelectors');c.textContent='';if(!sels.length)return;c.appendChild(buildLearnTable('Unstable Selectors',['Selector','Action','Fail Rate','Uses','Tests','Page'],sels.map(function(s){var sel=s.selector.length>45?s.selector.slice(0,42)+'...':s.selector;return[{code:sel},{text:s.action_type},{badge:s.fail_rate+'%',cls:s.fail_rate>30?'fail':'flaky'},{text:s.total_uses},{text:s.used_by_tests},{text:s.page_url||'-'}]})))}
function renderLearnPages(pages){var c=$('#learningsPages');c.textContent='';if(!pages.length)return;c.appendChild(buildLearnTable('Failing Pages',['Page','Fail Rate','Visits','Console Errors','Network Errors'],pages.map(function(p){return[{code:p.url_path},{badge:p.fail_rate+'%',cls:p.fail_rate>30?'fail':'flaky'},{text:p.total_visits},{text:p.console_errors},{text:p.network_errors}]})))}
function renderLearnApis(apis){var c=$('#learningsApis');c.textContent='';if(!apis.length)return;c.appendChild(buildLearnTable('API Issues',['Endpoint','Error Rate','Calls','Avg Duration','Status Codes'],apis.map(function(a){var ep=a.endpoint.length>45?a.endpoint.slice(0,42)+'...':a.endpoint;var d=a.avg_duration_ms<1000?Math.round(a.avg_duration_ms)+'ms':(a.avg_duration_ms/1000).toFixed(1)+'s';return[{code:ep},{badge:a.error_rate+'%',cls:a.error_rate>20?'fail':'flaky'},{text:a.total_calls},{text:d},{text:a.status_codes||'-'}]})))}
function renderLearnErrors(errors){var c=$('#learningsErrors');c.textContent='';if(!errors.length)return;c.appendChild(buildLearnTable('Error Patterns',['Pattern','Category','Count','First Seen','Last Seen','Example Test'],errors.map(function(e){var pat=e.pattern.length>50?e.pattern.slice(0,47)+'...':e.pattern;return[{text:pat},{badge:e.category,cls:'run'},{text:e.occurrence_count},{text:(e.first_seen||'-').split('T')[0]},{text:(e.last_seen||'-').split('T')[0]},{code:e.example_test||'-'}]})))}

$('#btnRefreshLearnings').addEventListener('click',refreshLearnings);
$('#learningsDays').addEventListener('change',refreshLearnings);

$('#btnExportLearnings').addEventListener('click',function(){
  var data=S.lastLearningsData;
  if(!data){showToast('No learnings data to export','error');return}
  var md='# E2E Learnings Report\n\n';
  md+='| Metric | Value |\n|--------|-------|\n';
  md+='| Total Runs | '+data.totalRuns+' |\n';
  md+='| Total Tests | '+data.totalTests+' |\n';
  md+='| Pass Rate | '+data.overallPassRate+'% |\n';
  md+='| Avg Duration | '+dur(data.avgDurationMs)+' |\n\n';
  if(data.flakyTests&&data.flakyTests.length){
    md+='## Flaky Tests\n\n| Test | Flaky Rate | Occurrences |\n|------|-----------|-------------|\n';
    data.flakyTests.forEach(function(f){md+='| '+f.test_name+' | '+f.flaky_rate+'% | '+f.flaky_count+' |\n'});md+='\n';
  }
  if(data.unstableSelectors&&data.unstableSelectors.length){
    md+='## Unstable Selectors\n\n| Selector | Action | Fail Rate |\n|----------|--------|-----------|\n';
    data.unstableSelectors.forEach(function(s){md+='| `'+s.selector+'` | '+s.action_type+' | '+s.fail_rate+'% |\n'});md+='\n';
  }
  downloadFile('learnings-report.md',md,'text/markdown');
  showToast('Learnings exported','success');
});

/* ══════════════════════════════════════════════════════════════════
   Variables
   ══════════════════════════════════════════════════════════════════ */
var _varsData={};

function refreshVariables(){
  if(!S.project){$('#variablesContainer').replaceChildren();$('#variablesEmpty').style.display='block';$('#badgeVariables').textContent='-';return}
  fetch('/api/db/projects/'+S.project+'/variables').then(function(r){return r.json()}).then(function(data){
    _varsData=data;
    renderVariables(data);
  }).catch(function(){$('#variablesContainer').replaceChildren();$('#variablesEmpty').style.display='block'});
}

function renderVariables(data){
  var container=$('#variablesContainer');
  container.replaceChildren();
  var scopes=Object.keys(data);
  var totalCount=0;
  scopes.forEach(function(s){totalCount+=Object.keys(data[s]).length});
  $('#badgeVariables').textContent=totalCount||'-';
  if(totalCount===0){$('#variablesEmpty').style.display='block';return}
  $('#variablesEmpty').style.display='none';

  // Sort: 'project' first, then suite names alphabetically
  scopes.sort(function(a,b){if(a==='project')return -1;if(b==='project')return 1;return a.localeCompare(b)});

  scopes.forEach(function(scope){
    var vars=data[scope];
    var keys=Object.keys(vars).sort();
    if(!keys.length)return;

    var group=el('div',{className:'var-scope-group'});
    var label=scope==='project'?'Project Variables':'Suite: '+scope;
    group.appendChild(el('div',{className:'var-scope-header'},[
      el('span',null,label),
      el('span',{className:'scope-badge'},keys.length+' var'+(keys.length===1?'':'s'))
    ]));

    var table=el('table',{className:'var-table'});
    var thead=el('thead');
    var hr=el('tr');
    hr.appendChild(el('th',{style:'width:200px'},'Key'));
    hr.appendChild(el('th',null,'Value'));
    hr.appendChild(el('th',{style:'width:140px;text-align:right'},'Actions'));
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody=el('tbody');
    keys.forEach(function(key){
      var tr=el('tr');
      tr.appendChild(el('td',{className:'var-key'},'{{var.'+key+'}}'));

      var valTd=el('td');
      var valSpan=el('span',{className:'var-value',onclick:function(){
        if(valSpan.classList.contains('revealed')){valSpan.textContent='\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';valSpan.classList.remove('revealed');valSpan.classList.add('var-value-masked')}
        else{valSpan.textContent=vars[key];valSpan.classList.add('revealed');valSpan.classList.remove('var-value-masked')}
      }});
      valSpan.textContent='\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
      valSpan.classList.add('var-value-masked');
      valTd.appendChild(valSpan);
      tr.appendChild(valTd);

      var actTd=el('td',{className:'var-actions'});
      actTd.appendChild(el('button',{onclick:function(){startEditVar(tr,scope,key,vars[key])}},'Edit'));
      actTd.appendChild(el('button',{className:'danger',onclick:function(){deleteVar(scope,key)}},'Delete'));
      tr.appendChild(actTd);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    group.appendChild(table);
    container.appendChild(group);
  });
}

function startEditVar(tr,scope,key,currentVal){
  var valTd=tr.children[1];
  valTd.replaceChildren();
  var input=el('input',{className:'var-edit-input',value:currentVal});
  valTd.appendChild(input);
  input.focus();
  input.select();
  function save(){
    var newVal=input.value;
    if(newVal===currentVal){refreshVariables();return}
    fetch('/api/db/projects/'+S.project+'/variables',{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({scope:scope,key:key,value:newVal})
    }).then(function(r){return r.json()}).then(function(){showToast('Variable updated','success');refreshVariables()}).catch(function(e){showToast('Error: '+e.message,'error')});
  }
  input.addEventListener('keydown',function(e){if(e.key==='Enter')save();if(e.key==='Escape')refreshVariables()});
  input.addEventListener('blur',save);
}

function deleteVar(scope,key){
  if(!confirm('Delete variable "'+key+'" (scope: '+scope+')?'))return;
  fetch('/api/db/projects/'+S.project+'/variables/'+encodeURIComponent(scope)+'/'+encodeURIComponent(key),{method:'DELETE'})
    .then(function(r){return r.json()}).then(function(){showToast('Variable deleted','success');refreshVariables()}).catch(function(e){showToast('Error: '+e.message,'error')});
}

$('#btnAddVar').addEventListener('click',function(){
  var form=$('#varAddForm');
  if(form.style.display!=='none'){form.style.display='none';return}
  form.replaceChildren();
  form.style.display='block';
  var wrap=el('div',{className:'var-add-form'});

  var scopeLabel=el('label',null,[el('span',null,'Scope'),el('input',{type:'text',id:'newVarScope',value:'project',placeholder:'project or suite name'})]);
  var keyLabel=el('label',null,[el('span',null,'Key'),el('input',{type:'text',id:'newVarKey',placeholder:'e.g. JWT_TOKEN'})]);
  var valLabel=el('label',{style:'flex:1'},[el('span',null,'Value'),el('input',{type:'text',id:'newVarValue',placeholder:'Variable value'})]);
  var saveBtn=el('button',{className:'btn sm primary',onclick:function(){
    var s=$('#newVarScope').value.trim()||'project';
    var k=$('#newVarKey').value.trim();
    var v=$('#newVarValue').value;
    if(!k){showToast('Key is required','error');return}
    fetch('/api/db/projects/'+S.project+'/variables',{
      method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({scope:s,key:k,value:v})
    }).then(function(r){return r.json()}).then(function(){showToast('Variable added','success');form.style.display='none';refreshVariables()}).catch(function(e){showToast('Error: '+e.message,'error')});
  }},'Save');
  var cancelBtn=el('button',{className:'btn sm',onclick:function(){form.style.display='none'}},'Cancel');

  wrap.appendChild(scopeLabel);
  wrap.appendChild(keyLabel);
  wrap.appendChild(valLabel);
  wrap.appendChild(saveBtn);
  wrap.appendChild(cancelBtn);
  form.appendChild(wrap);
  setTimeout(function(){$('#newVarKey').focus()},50);
});

/* ══════════════════════════════════════════════════════════════════
   Keyboard Shortcuts
   ══════════════════════════════════════════════════════════════════ */
document.addEventListener('keydown',function(e){
  var tag=document.activeElement.tagName;
  if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;
  if(e.key==='Escape'){
    if($('#kbModal').classList.contains('open')){$('#kbModal').classList.remove('open');return}
    if($('#modal').classList.contains('open')){$('#modal').classList.remove('open');return}
    if(S.selectedRun!==null){
      var expanded=document.querySelector('#runsBody tr.expanded');
      if(expanded){
        var next=expanded.nextElementSibling;
        if(next&&next.classList.contains('run-detail-row')){var w=next.querySelector('.rd-wrap');if(w)w.classList.remove('open');expanded.classList.remove('expanded');setTimeout(function(){if(next.parentNode)next.parentNode.removeChild(next)},350)}
        S.selectedRun=null;
      }
      return;
    }
    return;
  }
  if(e.key==='?'){$('#kbModal').classList.toggle('open');return}
  var viewMap={'1':'suites','2':'runs','3':'screenshots','4':'learnings','5':'live','6':'variables'};
  if(viewMap[e.key]){showView(viewMap[e.key]);return}
  if(e.key==='r'){
    if(S.view==='suites')refreshSuites();else if(S.view==='runs')refreshRuns();
    else if(S.view==='screenshots')refreshScreenshots();else if(S.view==='learnings')refreshLearnings();
    else if(S.view==='variables')refreshVariables();
    return;
  }
  if(S.view==='runs'&&(e.key==='j'||e.key==='k')){
    var visible=_allRunRows.filter(function(item){return item.tr.style.display!=='none'});
    if(!visible.length)return;
    if(e.key==='j')S.highlightedRunIdx=Math.min(S.highlightedRunIdx+1,visible.length-1);
    if(e.key==='k')S.highlightedRunIdx=Math.max(S.highlightedRunIdx-1,0);
    visible.forEach(function(item,i){if(i===S.highlightedRunIdx){item.tr.classList.add('selected');item.tr.scrollIntoView({block:'nearest'})}else item.tr.classList.remove('selected')});
    return;
  }
  if(S.view==='runs'&&e.key==='Enter'){
    var visible2=_allRunRows.filter(function(item){return item.tr.style.display!=='none'});
    if(S.highlightedRunIdx>=0&&S.highlightedRunIdx<visible2.length){visible2[S.highlightedRunIdx].tr.click()}
    return;
  }
});
$('#kbModal').addEventListener('click',function(e){if(e.target===$('#kbModal'))$('#kbModal').classList.remove('open')});

/* ══════════════════════════════════════════════════════════════════
   Init
   ══════════════════════════════════════════════════════════════════ */
connectWS();
refreshStatus();
refreshProjects();
refreshSuites();
refreshRuns();
refreshScreenshots();
refreshLearnings();
refreshVariables();
})();
