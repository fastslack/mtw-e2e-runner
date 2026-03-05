/* ── API & Pool ── */
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
  var poolList=$('#poolList');
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
  }else if(d.pools&&d.pools.length===1){
    var p=d.pools[0];
    $('#poolDot').className='pool-dot '+(p.error||!p.available?'off':'on');
    $('#poolLabel').textContent=p.error?'offline':p.available?'ready':'busy';
    $('#poolSessions').textContent=(p.running||0)+'/'+(p.maxConcurrent||0);
    poolList.style.display='none';
  }else{
    $('#poolDot').className='pool-dot '+(d.error||!d.available?'off':'on');
    $('#poolLabel').textContent=d.error?'offline':d.available?'ready':'busy';
    $('#poolSessions').textContent=(d.running||0)+'/'+(d.maxConcurrent||0);
    poolList.style.display='none';
  }
}
function refreshStatus(){api('/api/status').then(function(d){renderPool(d.pool)}).catch(function(){})}

/* ── Projects ── */
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
  refreshRuns();refreshSuites();refreshScreenshots();refreshLearnings();refreshWatch();
});
