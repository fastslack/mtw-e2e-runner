/* ══════════════════════════════════════════════════════════════════
   Live Execution View
   ══════════════════════════════════════════════════════════════════ */
function clearFinishedLiveRuns(){
  for(var k in S.liveRuns){if(S.liveRuns[k].done||!S.liveRuns[k].on)delete S.liveRuns[k]}
  S.screencastSel=null;S.screencastLast=null;
  var im=$('#screencastImg');if(im){im.src='';im.style.display='none';var vp=im.closest('.screencast-viewport');if(vp)vp.classList.remove('has-frame')}
  if(typeof resetFilmstrip==='function')resetFilmstrip();
  renderLive();
}
function dismissLiveRun(rid){
  if(S.screencastSel&&S.screencastSel.runId===rid)S.screencastSel=null;
  if(S.screencastLast&&S.screencastLast.runId===rid)S.screencastLast=null;
  delete S.liveRuns[rid];renderLive();
}
$('#liveClearBtn').addEventListener('click',clearFinishedLiveRuns);

/* Pick a test to screencast. Composite key {runId, name} so concurrent
   runs with the same test name never collide into a single <img>. */
function selectScreencast(runId,name){
  if(S.screencastSel&&S.screencastSel.runId===runId&&S.screencastSel.name===name){
    // Same test clicked again — unselect (stop watching)
    S.screencastSel=null;
  }else{
    S.screencastSel={runId:runId,name:name};
    // Clear the previous frame so we don't briefly show another test's last frame
    var im=$('#screencastImg');if(im){im.src='';im.style.display='none'}
  }
  renderLive();
}
function stopScreencast(){S.screencastSel=null;renderLive()}

var _scStopBtn=$('#screencastStopBtn');
if(_scStopBtn)_scStopBtn.addEventListener('click',stopScreencast);

/* Reset the live preview + filmstrip (used when the watched test changes so
   two tests' frames never pile up in the same feed). */
function clearScreencastFrame(){
  var im=$('#screencastImg');
  if(im){im.src='';im.style.display='none';var vp=im.closest('.screencast-viewport');if(vp)vp.classList.remove('has-frame')}
  S.screencastLast=null;
  if(typeof resetFilmstrip==='function')resetFilmstrip();
}

/* Test chooser: "auto" follows the latest test; a specific value pins the feed
   to that one test only. */
(function(){
  var sel=$('#screencastTestSelect');if(!sel)return;
  sel.addEventListener('change',function(){
    if(this.value==='auto'){
      S.screencastSel=null;S.screencastAuto=true;
    }else{
      var i=this.value.indexOf('::');
      S.screencastSel={runId:this.value.slice(0,i),name:this.value.slice(i+2)};
    }
    clearScreencastFrame();
    renderLive();
  });
})();

/* Keep the chooser's options in sync with the live tests — but only rebuild
   when the set actually changes, so it doesn't clobber the open dropdown. */
function syncScreencastSelect(){
  var sel=$('#screencastTestSelect');if(!sel)return;
  var items=[];
  Object.keys(S.liveRuns).forEach(function(rid){
    var run=S.liveRuns[rid];
    Object.keys(run.tests||{}).forEach(function(n){
      if(n==='__error')return;
      items.push({key:rid+'::'+n,runId:rid,name:n,status:run.tests[n].status});
    });
  });
  items.sort(function(a,b){return (a.status==='running'?0:1)-(b.status==='running'?0:1)});
  var curKey=S.screencastSel?(S.screencastSel.runId+'::'+S.screencastSel.name):'auto';
  var sig=curKey+'|'+items.map(function(o){return o.key+':'+o.status}).join(',');
  if(sel.getAttribute('data-sig')===sig)return;
  sel.setAttribute('data-sig',sig);
  sel.textContent='';
  sel.appendChild(el('option',{value:'auto'},'Auto — latest test'));
  items.forEach(function(o){
    var mark=o.status==='running'?'● ':o.status==='passed'?'✓ ':o.status==='failed'?'✕ ':'· ';
    sel.appendChild(el('option',{value:o.key},mark+o.name));
  });
  sel.value=curKey;
  if(sel.value!==curKey)sel.value='auto';
}

/* Click the live preview → open it full-size in the lightbox. */
(function(){
  var im=$('#screencastImg');
  if(im)im.addEventListener('click',function(){
    if(im.src&&im.src.indexOf('data:')===0&&typeof openModal==='function')openModal(im.src);
  });
})();

/* Filmstrip — keep a small ring buffer of recent frames, throttled so a
   high-rate screencast doesn't thrash the DOM. Each thumb opens full-size. */
var SC_FILM_MAX=24, SC_FILM_THROTTLE=600;
function pushFilmFrame(src,name,runId){
  var now=Date.now();
  if(now-(S._filmTs||0)<SC_FILM_THROTTLE)return;
  S._filmTs=now;
  S.screencastFilm.push({src:src,name:name||'',runId:runId||null,ts:now});
  while(S.screencastFilm.length>SC_FILM_MAX)S.screencastFilm.shift();
  renderFilmstrip();
}
/* Render the bottom band: recent frames in fixed slots that fit the width —
   no horizontal scroll, so the strip stays put while frames pass through it.
   Newest is the rightmost (marked LIVE). Any thumb opens full-size on click. */
function renderFilmstrip(){
  var strip=$('#screencastFilm');if(!strip)return;
  strip.textContent='';
  var film=S.screencastFilm||[];
  // Pinned to one test → show only its frames (safety net against mixing).
  if(S.screencastSel){
    film=film.filter(function(f){return f.runId===S.screencastSel.runId&&f.name===S.screencastSel.name});
  }
  if(!film.length){
    strip.appendChild(el('div',{className:'screencast-film-empty'},
      anyLiveRunning()?'Waiting for first frame…':'No frames yet'));
    return;
  }
  // Fit as many fixed-width slots as the band can show without scrolling.
  var h=strip.clientHeight||150, gap=10;
  var thumbW=Math.max(120,(h-28)*1.6);
  var avail=(strip.clientWidth||900)-32;
  var fit=Math.max(1,Math.floor((avail+gap)/(thumbW+gap)));
  var start=Math.max(0,film.length-fit);
  var shown=film.slice(start);
  var live=anyLiveRunning();
  shown.forEach(function(f,i){
    var isLast=(i===shown.length-1);
    var img=document.createElement('img');img.src=f.src;img.alt=f.name;img.loading='lazy';
    var thumb=el('div',{className:'film-thumb'+(isLast&&live?' is-live':''),
      title:(f.name||'frame')+' — click to enlarge',
      onclick:(function(s){return function(){if(typeof openModal==='function')openModal(s)}})(f.src)},
      [img,el('span',{className:'film-idx'},String(start+i+1))]);
    strip.appendChild(thumb);
  });
}
function resetFilmstrip(){S.screencastFilm=[];S._filmTs=0;renderFilmstrip()}

function scTestStatus(sel){
  if(!sel)return null;
  var r=S.liveRuns[sel.runId];if(!r)return 'gone';
  var t=r.tests&&r.tests[sel.name];if(!t)return 'gone';
  return t.status;
}

function updateScreencastUI(){
  var panel=$('#screencastPanel');
  var anyActive=false;for(var k in S.liveRuns)if(S.liveRuns[k].on)anyActive=true;
  var ctxEl=$('#screencastContext'),img=$('#screencastImg'),ph=$('#screencastPlaceholder'),stopBtn=$('#screencastStopBtn');
  var hasFrame=img&&img.src&&img.src.indexOf('data:')===0;

  var pinned=S.screencastSel;
  var auto=!pinned&&S.screencastAuto!==false;

  // Show panel while a run is active, a test is pinned, or a frame is on screen.
  panel.style.display=(anyActive||pinned||hasFrame)?'':'none';

  // Idle: nothing pinned, auto off (or nothing ever shown) and no activity.
  if(!pinned&&!auto&&!hasFrame){
    if(ctxEl){ctxEl.textContent='';ctxEl.className='screencast-context idle'}
    if(stopBtn)stopBtn.style.display='none';
    if(img)img.style.display='none';
    if(ph){ph.style.display='flex';ph.textContent=anyActive?'Waiting for first frame…':'No tests running'}
    return;
  }

  // Subject: the pinned test, or (auto) the test of the last frame shown.
  var sel=pinned||S.screencastLast;
  var status=pinned?scTestStatus(pinned):(anyActive?'running':'ended');
  var run=sel&&S.liveRuns[sel.runId];
  var proj=(run&&(run.project||(run.cwd?run.cwd.split('/').pop():'')))||'';

  if(ctxEl){
    ctxEl.textContent='';
    if(proj)ctxEl.appendChild(el('span',{className:'sc-ctx-proj'},proj));
    if(sel)ctxEl.appendChild(el('span',{className:'sc-ctx-name'},sel.name));
    var pillTxt,pillCls;
    if(pinned){
      pillTxt=status==='running'?'WATCHING':status==='passed'?'ENDED · PASSED':status==='failed'?'ENDED · FAILED':'GONE';
      pillCls=status==='running'?'running':status==='passed'?'passed':status==='failed'?'failed':'gone';
    }else{
      pillTxt=anyActive?'AUTO · LIVE':'AUTO · LAST FRAME';
      pillCls=anyActive?'running':'gone';
    }
    ctxEl.appendChild(el('span',{className:'sc-ctx-pill '+pillCls},pillTxt));
    ctxEl.className='screencast-context '+(((pinned&&status==='running')||(!pinned&&anyActive))?'active':'ended');
  }
  // Stop button only when pinned — it returns to auto-follow.
  if(stopBtn){stopBtn.style.display=pinned?'':'none';stopBtn.title='Stop watching (return to auto-follow)'}

  if(hasFrame)img.style.display='block';
  if(ph){
    if(hasFrame){ph.style.display='none'}
    else{ph.style.display='flex';ph.textContent=anyActive?'Waiting for first frame…':'No frames yet'}
  }
  // Keep the bottom band in sync (empty hint when no frames yet).
  if(typeof renderFilmstrip==='function')renderFilmstrip();
  if(typeof syncScreencastSelect==='function')syncScreencastSelect();
}

function renderLive(){
  var panel=$('#livePanel'),grid=$('#liveTests'),navLive=$('#navLive'),liveEmpty=$('#liveEmpty');
  var runs=S.liveRuns;var runIds=Object.keys(runs);

  if(runIds.length===0){
    panel.classList.remove('active');liveEmpty.style.display='block';$('#liveClearBtn').style.display='none';
    var lb=$('#liveBadge');lb.textContent='0';lb.className='badge idle';
    syncTopbarLive(false,0,0);
    return;
  }

  liveEmpty.style.display='none';panel.classList.add('active');

  var gTotal=0,gCompleted=0,gPassed=0,gFailed=0,gActive=0,gRunning=false,gDone=true;
  runIds.forEach(function(rid){var r=runs[rid];gTotal+=r.total;gCompleted+=r.completed;gPassed+=r.passed;gFailed+=r.failed;gActive+=r.active;if(r.on)gRunning=true;if(!r.done)gDone=false});

  var badgeActive=0;
  runIds.forEach(function(rid){var r=runs[rid];Object.keys(r.tests).forEach(function(n){if(n!=='__error'&&r.tests[n].status==='running')badgeActive++})});
  var lb2=$('#liveBadge');
  lb2.textContent=gRunning?badgeActive:gCompleted;
  lb2.className='badge '+(gRunning?'running':gFailed>0?'failed':'passed');
  syncTopbarLive(gRunning,badgeActive,gFailed);

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

      // Screencast watch button \u2014 only on running tests. Composite-key aware.
      var isWatched=S.screencastSel&&S.screencastSel.runId===rid&&S.screencastSel.name===name;
      var scWatchBtn=null;
      if(t.status==='running'){
        scWatchBtn=el('button',{
          className:'sc-watch-btn'+(isWatched?' active':''),
          title:isWatched?'Stop watching':'Watch this test',
          onclick:(function(_rid,_name){return function(e){e.stopPropagation();selectScreencast(_rid,_name)}})(rid,name)
        },[
          el('span',{className:'sc-eye'},isWatched?'\u25C9':'\u25CB'),
          el('span',{className:'sc-watch-label'},isWatched?'WATCHING':'WATCH')
        ]);
      }
      var serialBadge=t.serial?el('span',{className:'serial-badge'},'Serial'):null;
      var poolBadge=t.poolUrl?el('span',{className:'pool-badge'},t.poolUrl.replace('ws://','').replace('wss://','')):null;
      var cardCls='live-test '+t.status+(isCollapsed?' collapsed':'')+(isWatched?' sc-watching':'');
      var card=el('div',{className:cardCls},[
        el('div',{className:'lt-name'},[
          t.status==='running'?el('span',{className:'spinner'}):el('span',{className:'lt-icon',style:iconColor},iconText),
          document.createTextNode(' '+name),scWatchBtn,serialBadge,poolBadge,summaryEl
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
  updateScreencastUI();
}

/* Sync the top bar Live shortcut: greyed when idle, pulsing purple when running */
function syncTopbarLive(running,activeCount,failedCount){
  var pill=$('#topbarLive');if(!pill)return;
  var count=$('#topbarLiveCount');
  pill.classList.remove('idle','running','failed','passed');
  if(running){pill.classList.add('running');count.textContent=activeCount}
  else if(failedCount>0){pill.classList.add('failed');count.textContent=failedCount}
  else if(activeCount===0&&!running){pill.classList.add('idle');count.textContent='0'}
  else{pill.classList.add('passed');count.textContent=activeCount||0}
  // Mirror the running count to the telemetry strip
  if(typeof renderRunningTelemetry==='function')renderRunningTelemetry(running?activeCount:0);
}
