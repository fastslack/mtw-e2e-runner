/* ══════════════════════════════════════════════════════════════════
   Live Execution View
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

    var poolDist=buildPoolDistribution(L.tests);
    if(poolDist)grid.appendChild(poolDist);

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
          var stepCls='lt-step'+(a.isPoolLog?' pool-log':'');
          stepsEl.appendChild(el('div',{className:stepCls},[
            el('span',{className:'step-icon '+(a.isPoolLog?'':a.success?'ok':'fail')},a.isPoolLog?'\uD83D\uDD17':a.success?'\u2714':'\u2718'),
            el('span',{className:'step-type'},a.isPoolLog?'pool':a.type),
            el('span',{className:'step-detail'},a.isPoolLog?a.narrative:detail),
            retryBadge,
            a.isPoolLog?null:el('span',{className:'step-dur'},durText)
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
      var poolBadge=t.poolUrl?el('span',{className:'pool-badge'},t.poolUrl.replace('ws://','').replace('wss://','')):null;
      var card=el('div',{className:'live-test '+t.status+(isCollapsed?' collapsed':'')},[
        el('div',{className:'lt-name'},[
          t.status==='running'?el('span',{className:'spinner'}):el('span',{className:'lt-icon',style:iconColor},iconText),
          document.createTextNode(' '+name),serialBadge,poolBadge,summaryEl
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
