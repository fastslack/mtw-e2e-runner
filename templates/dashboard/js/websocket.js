/* ── WebSocket ── */
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
    case 'test:pool':
      var rp=getLiveRun(m);if(!rp||!rp.tests[m.name])break;
      rp.tests[m.name].poolUrl=m.poolUrl||null;
      rp.tests[m.name].actionLog.unshift({type:'pool',narrative:'\uD83D\uDD17 '+m.name+' \u2192 '+(m.poolUrl||'').replace('ws://','').replace('wss://',''),success:true,duration:null,isPoolLog:true});
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
        if(m.poolUrl)r5.tests[m.name].poolUrl=m.poolUrl;
      }
      r5.active=Math.max(0,r5.active-1);
      renderLive();break;
    case 'run:complete':
      var r6=getLiveRun(m);if(r6){r6.on=false;r6.done=true;r6.active=0}
      var summary=m.summary||{};
      var baseMsg='Run complete: '+(summary.failed>0?summary.failed+' failed':'all '+(summary.total||0)+' passed');
      var baseType=summary.failed>0?'error':'success';
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
      renderLive();refreshRuns();refreshProjects();refreshWatch();break;
    case 'run:error':
      var r7=getLiveRun(m);if(r7){r7.on=false;r7.done=true;r7.tests.__error={status:'failed',error:m.error}}
      showToast('Run error: '+m.error,'error');
      renderLive();break;
    case 'test:frame':
      if(S.screencastTest===m.name&&m.data){
        var img=$('#screencastImg');
        if(img)img.src='data:image/jpeg;base64,'+m.data;
      }
      break;
    case 'db:updated':
      refreshRuns();refreshProjects();refreshScreenshots();refreshLearnings();refreshWatch();break;
  }
}
