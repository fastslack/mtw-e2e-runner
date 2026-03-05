/* ══════════════════════════════════════════════════════════════════
   Watch View — Project Cards + Sparklines + Event Log
   ══════════════════════════════════════════════════════════════════ */
var _watchInterval=null;
var _countdownInterval=null;
var _watchData=null;

function refreshWatch(){
  // Fetch projects overview (sparklines)
  api('/api/db/projects/overview').then(function(projects){
    if(!Array.isArray(projects)||!projects.length){
      $('#watchCards').textContent='';
      $('#watchEmpty').style.display='block';
      return;
    }
    $('#watchEmpty').style.display='none';
    _watchData=projects;
    renderWatchCards(projects);
  }).catch(function(){
    // Fallback: use regular projects list
    api('/api/db/projects').then(function(projects){
      if(!Array.isArray(projects)||!projects.length){$('#watchEmpty').style.display='block';return}
      $('#watchEmpty').style.display='none';
      _watchData=projects.map(function(p){return Object.assign({},p,{sparkline:[]})});
      renderWatchCards(_watchData);
    }).catch(function(){});
  });

  // Fetch event log (recent runs)
  var runsUrl=S.project?'/api/db/projects/'+S.project+'/runs':'/api/db/runs';
  api(runsUrl).then(function(runs){
    renderEventLog(runs);
  }).catch(function(){});

  // Fetch watch jobs status for countdown
  fetch('/api/watch/status').then(function(r){
    if(!r.ok)throw new Error('not running');
    return r.json();
  }).then(function(jobs){
    applyWatchJobData(jobs);
  }).catch(function(){
    // Watch engine not running — that's fine, cards still show
  });
}

function renderWatchCards(projects){
  var container=$('#watchCards');
  container.textContent='';

  projects.forEach(function(p){
    var sparkline=p.sparkline||[];
    var lastRate=sparkline.length?sparkline[sparkline.length-1]:null;
    var rateColor=lastRate===null?'dim':lastRate>=90?'green':lastRate>=70?'amber':'red';
    var dotColor=rateColor;

    var sparkEl=el('div',{className:'watch-sparkline'});
    if(sparkline.length>=2){
      sparkEl.appendChild(buildSparkline(sparkline));
    } else {
      sparkEl.style.cssText='height:40px;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:10px';
      sparkEl.textContent=sparkline.length?'1 run':'No runs yet';
    }

    var triggerBtn=el('button',{className:'btn sm',onclick:function(e){e.stopPropagation();triggerRun(null,p.id)}},'\u25B6');
    var detailBtn=el('button',{className:'btn sm',onclick:function(e){
      e.stopPropagation();
      S.project=p.id;$('#projectSelect').value=p.id;
      showView('runs');
      refreshRuns();refreshSuites();
    }},'\uD83D\uDD0D');

    var card=el('div',{className:'watch-card',id:'watch-card-'+p.id},[
      el('div',{className:'watch-card-header'},[
        el('div',{className:'watch-card-name'},p.name),
        el('div',{className:'watch-card-icons'},[triggerBtn,detailBtn])
      ]),
      sparkEl,
      el('div',{className:'watch-card-footer'},[
        el('div',{className:'watch-card-status'},[
          el('span',{className:'status-dot '+dotColor}),
          el('span',{className:'watch-card-rate '+rateColor},lastRate!==null?lastRate+'%':'—')
        ]),
        el('span',{style:'color:var(--text3);font-size:10px'},p.runCount?p.runCount+' runs':'')
      ]),
      el('div',{className:'watch-card-meta'},[
        el('span',{className:'watch-card-countdown',id:'watch-countdown-'+p.id},''),
        p.lastCommit?el('span',{className:'watch-card-commit'},'\u{1F4CB} '+p.lastCommit.slice(0,8)):null
      ])
    ]);

    container.appendChild(card);
  });
}

function buildSparkline(data){
  var ns='http://www.w3.org/2000/svg';
  var svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 200 40');
  svg.setAttribute('preserveAspectRatio','none');

  var n=data.length;
  var w=200/(n-1||1);
  var pts=data.map(function(v,i){return (i*w)+','+(40-v*0.4)}).join(' ');

  // Gradient fill
  var poly=document.createElementNS(ns,'polygon');
  poly.setAttribute('points','0,40 '+pts+' '+((n-1)*w)+',40');
  poly.setAttribute('fill','var(--accent-dim)');
  svg.appendChild(poly);

  // Line
  var pl=document.createElementNS(ns,'polyline');
  pl.setAttribute('points',pts);
  pl.setAttribute('fill','none');
  pl.setAttribute('stroke','var(--accent)');
  pl.setAttribute('stroke-width','1.5');
  svg.appendChild(pl);

  // End dot
  if(n>0){
    var lastVal=data[n-1];
    var dotColor=lastVal>=90?'var(--green)':lastVal>=70?'var(--amber)':'var(--red)';
    var circle=document.createElementNS(ns,'circle');
    circle.setAttribute('cx',''+(n-1)*w);
    circle.setAttribute('cy',''+(40-lastVal*0.4));
    circle.setAttribute('r','3');
    circle.setAttribute('fill',dotColor);
    svg.appendChild(circle);
  }

  return svg;
}

function applyWatchJobData(jobs){
  if(!jobs||!jobs.length)return;
  jobs.forEach(function(j){
    // Find matching card by project name
    if(!_watchData)return;
    var match=_watchData.find(function(p){return p.name===j.name||p.cwd===j.cwd});
    if(!match)return;
    var cdEl=$('#watch-countdown-'+match.id);
    if(cdEl&&j.nextRunAt){
      cdEl.dataset.nextRunAt=j.nextRunAt;
      updateCountdown(cdEl);
    }
  });
  startCountdownTimer();
}

function startCountdownTimer(){
  if(_countdownInterval)return;
  _countdownInterval=setInterval(function(){
    $$('.watch-card-countdown[data-next-run-at]').forEach(updateCountdown);
  },1000);
}

function updateCountdown(cdEl){
  var next=cdEl.dataset.nextRunAt;
  if(!next){cdEl.textContent='';return}
  var diff=new Date(next)-Date.now();
  if(diff<=0){cdEl.textContent='\u23F1 Running...';return}
  var m=Math.floor(diff/60000);
  var s=Math.floor((diff%60000)/1000);
  cdEl.textContent='\u23F1 Next: '+m+'m '+String(s).padStart(2,'0')+'s';
}

function renderEventLog(runs){
  var container=$('#watchEventLog');
  if(!container)return;
  container.textContent='';

  if(!Array.isArray(runs)||!runs.length){
    container.appendChild(el('div',{style:'padding:16px;text-align:center;color:var(--text3);font-size:11px'},'No runs recorded yet.'));
    return;
  }

  // Column header row
  container.appendChild(el('div',{className:'watch-event-row we-header'},[
    el('span',null,'Time'),
    el('span',null,'Project'),
    el('span',null,'Suite'),
    el('span',{style:'justify-self:center'},'Status'),
    el('span',{style:'text-align:center'},'Tests'),
    el('span',{style:'text-align:right'},'Rate'),
    el('span',{style:'text-align:right'},'Duration'),
    el('span',{style:'text-align:right'},'Source')
  ]));

  var recent=runs.slice(0,30);
  recent.forEach(function(r){
    var rate=parseFloat(r.pass_rate)||0;
    var badgeCls=r.failed>0?'fail':'pass';
    var badgeText=r.failed>0?'FAIL':'PASS';

    // Test counts: "5/5" or "3/5 (2 fail)"
    var countsText=r.passed+'/'+r.total;
    var countsParts=[el('span',{className:'we-counts-ok'},String(r.passed))];
    countsParts.push(document.createTextNode('/'+r.total));
    if(r.failed>0){
      countsParts.push(document.createTextNode(' ('));
      countsParts.push(el('span',{style:'color:var(--red)'},r.failed+' fail'));
      countsParts.push(document.createTextNode(')'));
    }

    // Trigger badge
    var triggerIcon={'cli':'\u2318','dashboard':'\uD83D\uDCBB','mcp':'\u2699','watch':'\u23F1','api':'\u26A1'};
    var trigSrc=r.triggered_by||'cli';
    var trigEl=el('span',{className:'we-trigger',title:'Triggered by: '+trigSrc},(triggerIcon[trigSrc]||'\u2318')+' '+trigSrc);

    var row=el('div',{className:'watch-event-row',style:'cursor:pointer'},[
      el('span',{className:'watch-event-time'},fdate(r.generated_at)),
      el('span',{className:'watch-event-project'},r.project_name||'—'),
      el('span',{className:'watch-event-suite'},r.suite_name||'all'),
      el('span',{className:'watch-event-result'},[el('span',{className:'badge '+badgeCls},badgeText)]),
      el('span',{className:'watch-event-counts'},countsParts),
      el('span',{className:'watch-event-rate'},rate>0?rate.toFixed(0)+'%':'—'),
      el('span',{className:'watch-event-duration'},r.duration?dur(r.duration):'—'),
      trigEl
    ]);

    // Click to navigate to run detail
    (function(run){
      row.addEventListener('click',function(){
        S.project=run.project_id;$('#projectSelect').value=run.project_id;
        showView('runs');
        refreshRuns();
      });
    })(r);

    container.appendChild(row);
  });
}

function startWatchPolling(){
  if(_watchInterval)return;
  refreshWatch();
  _watchInterval=setInterval(refreshWatch,10000);
}
function stopWatchPolling(){
  if(_watchInterval){clearInterval(_watchInterval);_watchInterval=null}
  if(_countdownInterval){clearInterval(_countdownInterval);_countdownInterval=null}
}
