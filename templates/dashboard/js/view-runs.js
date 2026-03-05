/* ══════════════════════════════════════════════════════════════════
   Runs View — History + Screenshots + Learnings (inner tabs)
   ══════════════════════════════════════════════════════════════════ */

/* ── Filters ── */
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
    banner.appendChild(el('div',{className:'hb-link',onclick:function(){var lb=$('#runsTabLearnings');if(lb)lb.click()}},[
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

/* ── Run Detail ── */
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

    // Insights
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
      if(items.length>0){items.forEach(function(it){insightsContainer.appendChild(it)})}
      else{insightsContainer.style.display='none'}
    }).catch(function(){insightsContainer.style.display='none'});

    // Pool distribution bar
    var histPoolTests={};
    results.forEach(function(r){if(!r.poolUrl)return;histPoolTests[r.name]={poolUrl:r.poolUrl,success:r.success}});
    var histPoolDist=buildPoolDistribution(histPoolTests);
    if(histPoolDist)inner.appendChild(histPoolDist);

    results.forEach(function(r){
      var d2=r.durationMs?dur(r.durationMs):r.endTime&&r.startTime?dur(new Date(r.endTime)-new Date(r.startTime)):'-';
      var flaky=r.success&&r.attempt>1;
      var state=flaky?'flaky':(r.success?'pass':'fail');

      var badges=el('div',{style:'display:flex;gap:6px;align-items:center;flex-shrink:0'});
      badges.appendChild(el('span',{className:'badge '+(r.success?'pass':'fail')},r.success?'PASS':'FAIL'));
      if(flaky)badges.appendChild(el('span',{className:'badge flaky'},'FLAKY'));

      var poolEl=r.poolUrl?el('span',{className:'pool-badge'},r.poolUrl.replace('ws://','').replace('wss://',''))  :null;
      var head=el('div',{className:'rd-test-head'},[badges,el('div',{className:'rd-test-name'},[document.createTextNode(r.name),poolEl]),el('div',{className:'rd-test-dur'},d2)]);
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

/* ── Screenshots ── */
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

/* ── Learnings ── */
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
  var bg=document.createElementNS(ns,'rect');bg.setAttribute('x','0');bg.setAttribute('y','0');bg.setAttribute('width','100');bg.setAttribute('height','100');bg.setAttribute('fill','var(--surface2)');bg.setAttribute('rx','2');svg.appendChild(bg);
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

/* ── Modal ── */
function openModal(src){$('#modalImg').src=src;$('#modal').classList.add('open')}
$('#modal').addEventListener('click',function(){$('#modal').classList.remove('open')});
