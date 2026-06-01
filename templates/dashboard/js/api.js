/* ── API & Pool ── */
function api(p){return fetch(p).then(function(r){return r.json()})}
function triggerRun(suite,projectId){
  if(anyLiveRunning())return;
  var body={};
  if(suite)body.suite=suite;
  if(projectId)body.projectId=projectId;
  else if(S.project)body.projectId=S.project;
  var scToggle=$('#screencastToggle');
  if(scToggle&&scToggle.checked)body.screencast=true;
  fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

function renderPool(d){
  if(!d)return;
  var poolList=$('#poolList');
  // Telemetry strip — driver + sessions
  var teleDriver=(d.pools&&d.pools[0]&&d.pools[0].driver)||d.driver||'';
  var teleAvail=false;
  var teleSessNow=0,teleSessMax=0;
  if(d.pools&&d.pools.length>1){
    var anyAvail=d.availableCount>0;
    $('#poolDot').className='pool-dot '+(anyAvail?'on':'off');
    $('#poolLabel').textContent=anyAvail?d.availableCount+'/'+d.totalPools+' ready':'all busy';
    $('#poolSessions').textContent=(d.totalRunning||0)+'/'+(d.totalMaxConcurrent||0);
    poolList.textContent='';poolList.style.display='';
    d.pools.forEach(function(p){
      var label=(p.url||'').replace('ws://','').replace('wss://','');
      var ok=!p.error&&p.available;
      var dot=el('span',{className:'pool-dot '+(ok?'on':'off')});
      var name=el('strong',{},label);
      var status=el('span',{},p.error?'offline':p.available?'ready':'busy');
      var sess=el('span',{className:'pool-sessions'},(p.running||0)+'/'+(p.maxConcurrent||0));
      poolList.appendChild(el('div',{className:'pool-item'},[dot,name,status,sess]));
    });
    teleAvail=anyAvail;teleSessNow=d.totalRunning||0;teleSessMax=d.totalMaxConcurrent||0;
    teleDriver=teleDriver||(d.pools.length+' pools');
  }else if(d.pools&&d.pools.length===1){
    var p=d.pools[0];
    $('#poolDot').className='pool-dot '+(p.error||!p.available?'off':'on');
    $('#poolLabel').textContent=p.error?'offline':p.available?'ready':'busy';
    $('#poolSessions').textContent=(p.running||0)+'/'+(p.maxConcurrent||0);
    poolList.style.display='none';
    teleAvail=!p.error&&p.available;teleSessNow=p.running||0;teleSessMax=p.maxConcurrent||0;
    teleDriver=teleDriver||p.driver||'cdp';
  }else{
    $('#poolDot').className='pool-dot '+(d.error||!d.available?'off':'on');
    $('#poolLabel').textContent=d.error?'offline':d.available?'ready':'busy';
    $('#poolSessions').textContent=(d.running||0)+'/'+(d.maxConcurrent||0);
    poolList.style.display='none';
    teleAvail=!d.error&&d.available;teleSessNow=d.running||0;teleSessMax=d.maxConcurrent||0;
  }
  // Telemetry pills (best-effort — elements may not exist on older templates)
  var dotEl=$('#telePoolDot');if(dotEl)dotEl.className='tele-pill-dot '+(teleAvail?'on':'off');
  var valEl=$('#telePoolValue');if(valEl)valEl.textContent=teleDriver||'--';
  var sessEl=$('#teleSessionsValue');if(sessEl)sessEl.textContent=teleSessNow+'/'+teleSessMax;
}
function renderRunningTelemetry(n){
  var v=$('#teleRunningValue');if(!v)return;
  v.textContent=String(n||0);
  var pill=$('#teleRunning');if(pill)pill.classList.toggle('has-running',(n||0)>0);
}
function refreshTodayTelemetry(){
  var v=$('#teleTodayValue');if(!v)return;
  var url=S.project?'/api/db/projects/'+S.project+'/runs':'/api/db/runs';
  api(url).then(function(rows){
    if(!Array.isArray(rows))return;
    var today=new Date();today.setHours(0,0,0,0);var t=today.getTime();
    var c=0;
    rows.forEach(function(r){
      var d=r.generated_at||r.started_at||r.created_at;
      if(!d)return;
      var ts=new Date(d).getTime();
      if(ts>=t)c++;
    });
    v.textContent=String(c);
  }).catch(function(){});
}
function refreshStatus(){
  api('/api/status').then(function(d){
    renderPool(d.pool);
    // Telemetry: running count from dashboard.running flag fallback
    if(d.dashboard&&typeof d.dashboard.runningTests==='number'){
      renderRunningTelemetry(d.dashboard.runningTests);
    }
  }).catch(function(){});
}

/* ── Projects ── */
function refreshProjects(){
  api('/api/db/projects').then(function(projects){
    var sel=$('#projectSelect');
    // Prefer in-memory state, then the persisted selection, then whatever the
    // browser restored into the <select> on reload.
    var saved=null;try{saved=localStorage.getItem('e2e-project')}catch(e){}
    var prev=(S.project!=null?String(S.project):'')||saved||sel.value;
    while(sel.options.length>1)sel.remove(1);
    if(Array.isArray(projects))projects.forEach(function(p){
      var o=document.createElement('option');o.value=p.id;o.textContent=p.name;sel.appendChild(o);
    });
    // Only keep the previous value if it still maps to a real option.
    var valid=prev&&Array.prototype.some.call(sel.options,function(o){return o.value===prev});
    sel.value=valid?prev:'';
    // Sync app state to the restored <select> value. The browser restores the
    // dropdown's visual value across reloads, but never fires a 'change' event,
    // so S.project would otherwise stay null and views render "select a project".
    var resolved=sel.value?parseInt(sel.value,10):null;
    if(resolved!==S.project){
      S.project=resolved;
      refreshRuns();refreshSuites();refreshScreenshots();refreshLearnings();refreshWatch();
    }
  }).catch(function(){});
}
$('#projectSelect').addEventListener('change',function(){
  S.project=this.value?parseInt(this.value,10):null;
  S.selectedRun=null;
  try{S.project!=null?localStorage.setItem('e2e-project',String(S.project)):localStorage.removeItem('e2e-project')}catch(e){}
  refreshRuns();refreshSuites();refreshScreenshots();refreshLearnings();refreshWatch();
});
