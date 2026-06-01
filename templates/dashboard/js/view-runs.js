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
    banner.appendChild(el('div',{className:'hb-link',onclick:function(){showView('insights')}},[
      el('span',null,'\u2192 View Insights')
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
    cols=cols.concat(['Suite','Driver','Source','Date','Total','Pass','Fail','Rate','Time']);
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
      var driverTd=document.createElement('td');driverTd.appendChild(createDriverBadge(r.pool_driver));tr.appendChild(driverTd);
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
    var drvBlock=el('div',null,[el('div',{className:'rd-s-label'},'Driver'),el('div',{style:'margin-top:4px'},[createDriverBadge(d.poolDriver)])]);
    var summ=el('div',{className:'rd-summary'},[
      el('div',null,[el('div',{className:'rd-s-label'},'Suite'),el('div',{className:'rd-s-val',style:'font-size:14px;color:var(--accent)'},d.suiteName||'all')]),
      drvBlock,
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

      // Storyline \u2014 unified per-step cards with thumbnails, narrative, duration bar
      if(r.actions&&r.actions.length){
        var passCount=r.actions.filter(function(a){return a.success}).length;
        var failCount=r.actions.length-passCount;
        var maxDur=Math.max.apply(null,r.actions.map(function(a){return a.duration||0}).concat([1]));
        var hashes=r.screenshotHashes||{};

        // "Play replay" button \u2014 only shown if at least one step has a screenshot
        var hasFrames=r.actions.some(function(a){return a.autoScreenshot||a.screenshot})||(!r.success&&r.errorScreenshot);
        var replayBtn=hasFrames?el('button',{
          className:'rd-replay-btn',
          title:'Replay step-by-step',
          onclick:function(e){e.stopPropagation();openReplay(r.actions,r)}
        },'\u25B6 Replay'):null;
        var slHead=el('div',{className:'rd-net-head open'},[
          el('span',{className:'net-arrow'},'\u25B6'),
          el('span',{className:'net-title'},'Storyline'),
          el('div',{className:'net-stats'},[
            el('span',{className:'net-stat'},[document.createTextNode('Steps: '),el('strong',null,String(r.actions.length))]),
            failCount?el('span',{className:'net-stat has-err'},[document.createTextNode('Failed: '),el('strong',null,String(failCount))]):null,
            el('span',{className:'net-stat'},[document.createTextNode('Passed: '),el('strong',null,String(passCount))])
          ]),
          replayBtn
        ]);
        var slBody=el('div',{className:'storyline'});

        r.actions.forEach(function(a,idx){
          var stepNum=String(idx+1).padStart(2,'0');
          var label=a.narrative||a.type;
          var durText=a.duration!=null?dur(a.duration):'';
          var durPct=a.duration?Math.max(2,Math.round((a.duration/maxDur)*100)):0;
          var stateCls=a.success?'pass':'fail';
          var icon=a.success?'\u2714':'\u2718';

          // Thumbnail: prefer autoScreenshot, fall back to action's own screenshot
          var thumbPath=a.autoScreenshot||a.screenshot||null;
          var thumb;
          if(thumbPath){
            var src='/api/image?path='+encodeURIComponent(thumbPath);
            var img=document.createElement('img');
            img.src=src;img.alt=label;img.loading='lazy';
            thumb=el('div',{className:'sl-thumb',onclick:function(e){e.stopPropagation();openModal(src)}},[img]);
          }else{
            thumb=el('div',{className:'sl-thumb sl-thumb-empty',title:'No screenshot for this step'},[el('span',null,'\u25A1')]);
          }

          // Param chips (selector / text / value)
          var chips=el('div',{className:'sl-chips'});
          if(a.selector)chips.appendChild(el('span',{className:'sl-chip sl-chip-sel'},[el('span',{className:'sl-chip-k'},'sel'),el('span',{className:'sl-chip-v'},a.selector)]));
          if(a.text)chips.appendChild(el('span',{className:'sl-chip'},[el('span',{className:'sl-chip-k'},'text'),el('span',{className:'sl-chip-v'},String(a.text))]));
          if(a.value!=null&&a.value!=='')chips.appendChild(el('span',{className:'sl-chip'},[el('span',{className:'sl-chip-k'},'val'),el('span',{className:'sl-chip-v'},String(a.value))]));

          var retryBadge=(a.actionRetries&&a.actionRetries>0)?el('span',{className:'sl-retry'},'\u21BB '+a.actionRetries):null;

          var hashBadge=null;
          if(thumbPath){
            if(hashes[thumbPath]){hashBadge=createHashBadge(hashes[thumbPath])}
            else{(function(holder,fp){ssHash(fp).then(function(h){if(h)holder.appendChild(createHashBadge(h))})})}
          }

          var titleRow=el('div',{className:'sl-title'},[
            el('span',{className:'sl-num'},stepNum),
            el('span',{className:'sl-icon '+stateCls},icon),
            el('span',{className:'sl-type'},a.type),
            el('span',{className:'sl-narr'},label),
            retryBadge,
            el('span',{className:'sl-dur'},durText)
          ]);

          var durBar=el('div',{className:'sl-bar'},[el('div',{className:'sl-bar-fill '+stateCls,style:'width:'+durPct+'%'})]);

          var info=el('div',{className:'sl-info'},[
            titleRow,
            chips.children.length?chips:null,
            durBar
          ]);

          var card=el('div',{className:'sl-step '+stateCls},[thumb,info]);

          if(!a.success&&a.error){
            var errBlock=el('div',{className:'sl-err'},[
              el('span',{className:'sl-err-tag'},'ERROR'),
              el('span',{className:'sl-err-msg'},String(a.error))
            ]);
            card.appendChild(errBlock);
          }

          slBody.appendChild(card);
        });

        // Final failure context card (uses test-level errorScreenshot if present)
        if(!r.success&&r.errorScreenshot){
          var errSrc='/api/image?path='+encodeURIComponent(r.errorScreenshot);
          var errImg=document.createElement('img');errImg.src=errSrc;errImg.alt='Failure context';errImg.loading='lazy';
          var errCard=el('div',{className:'sl-step sl-final-err'},[
            el('div',{className:'sl-thumb sl-thumb-err',onclick:function(e){e.stopPropagation();openModal(errSrc)}},[errImg]),
            el('div',{className:'sl-info'},[
              el('div',{className:'sl-title'},[
                el('span',{className:'sl-num'},'\u26A0'),
                el('span',{className:'sl-icon fail'},'\u2718'),
                el('span',{className:'sl-narr sl-final-msg'},'Page state at failure')
              ]),
              r.error?el('div',{className:'sl-err'},[el('span',{className:'sl-err-tag'},'TEST FAILED'),el('span',{className:'sl-err-msg'},String(r.error))]):null
            ])
          ]);
          slBody.appendChild(errCard);
        }

        slHead.addEventListener('click',function(){slHead.classList.toggle('open');slBody.classList.toggle('hidden')});
        body.appendChild(el('div',{className:'rd-net-panel rd-storyline-panel'},[slHead,slBody]));
      } else if(r.errorScreenshot){
        // No actions but we have an error screenshot \u2014 show it standalone
        var errSrcOnly='/api/image?path='+encodeURIComponent(r.errorScreenshot);
        var errImgOnly=document.createElement('img');errImgOnly.src=errSrcOnly;errImgOnly.loading='lazy';
        body.appendChild(el('div',{className:'sl-final-err-standalone',onclick:function(e){e.stopPropagation();openModal(errSrcOnly)}},[errImgOnly]));
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
      gal.appendChild(el('div',{className:'gallery-item','data-path':f.path,onclick:function(){openModal(src)}},[img,capEl]));
    });
    resetBlankBar();
  }).catch(function(){});
}

/* ── Blank screenshot scan / delete ── */
function resetBlankBar(){
  var bar=$('#ssBlankBar');if(bar)bar.hidden=true;
  $$('#screenshotGallery .gallery-item.blank-flagged').forEach(function(it){it.classList.remove('blank-flagged')});
  S.blankPaths=null;
}
function scanBlankScreenshots(){
  if(!S.project){showToast('Select a project first','error');return}
  var btn=$('#ssScanBlankBtn');btn.disabled=true;var prev=btn.textContent;btn.textContent='Scanning…';
  api('/api/db/projects/'+S.project+'/screenshots/blank-scan').then(function(data){
    btn.disabled=false;btn.textContent=prev;
    var blanks=(data&&data.blanks)||[];
    $$('#screenshotGallery .gallery-item.blank-flagged').forEach(function(it){it.classList.remove('blank-flagged')});
    if(!blanks.length){
      S.blankPaths=null;$('#ssBlankBar').hidden=true;
      showToast('No blank images found ('+((data&&data.scanned)||0)+' scanned)','info');
      return;
    }
    S.blankPaths=blanks.map(function(b){return b.path});
    var found=0;
    S.blankPaths.forEach(function(p){
      var item=$('#screenshotGallery .gallery-item[data-path="'+(window.CSS&&CSS.escape?CSS.escape(p):p)+'"]');
      if(item){item.classList.add('blank-flagged');found++}
    });
    $('#ssBlankMsg').textContent=blanks.length+' blank image'+(blanks.length===1?'':'s')+' of '+data.scanned+' scanned';
    $('#ssBlankBar').hidden=false;
  }).catch(function(){
    btn.disabled=false;btn.textContent=prev;
    showToast('Blank scan failed','error');
  });
}
function deleteBlankScreenshots(){
  if(!S.blankPaths||!S.blankPaths.length)return;
  var btn=$('#ssBlankDeleteBtn');btn.disabled=true;var prev=btn.textContent;btn.textContent='Deleting…';
  fetch('/api/screenshots/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:S.blankPaths})})
    .then(function(r){return r.json()}).then(function(res){
      btn.disabled=false;btn.textContent=prev;
      if(res&&res.error){showToast('Delete failed: '+res.error,'error');return}
      var n=res.deleted||0,failed=(res.failed&&res.failed.length)||0;
      showToast('Deleted '+n+' blank image'+(n===1?'':'s')+(failed?(' · '+failed+' failed'):''),failed?'error':'success');
      resetBlankBar();
      refreshScreenshots();
    }).catch(function(){
      btn.disabled=false;btn.textContent=prev;
      showToast('Delete failed','error');
    });
}
$('#ssScanBlankBtn').addEventListener('click',scanBlankScreenshots);
$('#ssBlankDeleteBtn').addEventListener('click',deleteBlankScreenshots);
$('#ssBlankCancelBtn').addEventListener('click',resetBlankBar);

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
      $('#learnHero').textContent='';$('#learnCards').textContent='';
      $('#learnTrend').textContent='';$('#learnBottom').textContent='';
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
    renderLearnHero(data);
    renderLearnCards(data);
    renderLearnTrend(data.recentTrend||[]);
    renderLearnBottomRow(data);
  }).catch(function(){$('#learningsEmpty').style.display='block'});
}

function rateColor(v){return v>=90?'var(--green)':v>=70?'var(--amber)':'var(--red)'}
function rateClass(v){return v>=90?'good':v>=70?'warn':'bad'}
function durFmt(ms){return ms<1000?Math.round(ms)+'ms':(ms/1000).toFixed(1)+'s'}

function renderLearnHero(d){
  var c=$('#learnHero');c.textContent='';
  var wrap=document.createElement('div');wrap.className='learn-hero';
  var passRate=d.overallPassRate||0;
  var ns='http://www.w3.org/2000/svg';
  var ringWrap=document.createElement('div');ringWrap.className='learn-hero-ring';
  var svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 36 36');
  var bgCircle=document.createElementNS(ns,'circle');bgCircle.setAttribute('cx','18');bgCircle.setAttribute('cy','18');bgCircle.setAttribute('r','15.9');bgCircle.className.baseVal='learn-hero-ring-bg';svg.appendChild(bgCircle);
  var fgCircle=document.createElementNS(ns,'circle');fgCircle.setAttribute('cx','18');fgCircle.setAttribute('cy','18');fgCircle.setAttribute('r','15.9');fgCircle.className.baseVal='learn-hero-ring-fg';
  var circ=2*Math.PI*15.9;fgCircle.setAttribute('stroke-dasharray',circ.toFixed(1));fgCircle.setAttribute('stroke-dashoffset',(circ*(1-passRate/100)).toFixed(1));fgCircle.setAttribute('stroke',rateColor(passRate));
  svg.appendChild(fgCircle);ringWrap.appendChild(svg);
  var pctEl=document.createElement('div');pctEl.className='learn-hero-pct';pctEl.style.color=rateColor(passRate);pctEl.textContent=passRate+'%';
  ringWrap.appendChild(pctEl);wrap.appendChild(ringWrap);

  var stats=document.createElement('div');stats.className='learn-hero-stats';
  var badSels=d.unstableSelectors?d.unstableSelectors.length:0;
  var slowTests=d.failingPages?d.failingPages.length:0;
  var apiIssues=d.apiIssues?d.apiIssues.length:0;
  var topErr=d.topErrors&&d.topErrors.length>0?d.topErrors[0].occurrence_count:0;
  var flakyCount=d.flakyTests?d.flakyTests.length:0;
  var items=[
    {val:String(d.totalRuns),lbl:'Runs',color:'var(--accent)'},
    {val:String(d.totalTests),lbl:'Tests',color:'var(--accent)'},
    {val:durFmt(d.avgDurationMs||0),lbl:'Avg Duration',color:'var(--purple)'},
    {val:String(flakyCount),lbl:'Flaky',color:flakyCount>0?'var(--amber)':'var(--green)'},
    {val:String(badSels),lbl:'Bad Selectors',color:badSels>0?'var(--red)':'var(--green)'},
    {val:String(slowTests),lbl:'Slow Pages',color:slowTests>0?'var(--amber)':'var(--green)'},
    {val:String(apiIssues),lbl:'API Issues',color:apiIssues>0?'var(--red)':'var(--green)'},
    {val:String(topErr),lbl:'Top Error Hits',color:topErr>0?'var(--red)':'var(--green)'}
  ];
  items.forEach(function(it){
    var statEl=document.createElement('div');statEl.className='learn-hero-stat';
    var valEl=document.createElement('div');valEl.className='learn-hero-stat-val';valEl.style.color=it.color;valEl.textContent=it.val;
    var lblEl=document.createElement('div');lblEl.className='learn-hero-stat-lbl';lblEl.textContent=it.lbl;
    statEl.appendChild(valEl);statEl.appendChild(lblEl);stats.appendChild(statEl);
  });
  wrap.appendChild(stats);c.appendChild(wrap);
}

function makeLearnItem(label,sub,pct,valText,color){
  var item=document.createElement('div');item.className='learn-item';
  var barWrap=document.createElement('div');barWrap.className='learn-item-bar';
  var lblEl=document.createElement('div');lblEl.className='learn-item-label';
  var codeEl=document.createElement('code');codeEl.textContent=label;lblEl.appendChild(codeEl);
  barWrap.appendChild(lblEl);
  if(sub){var subEl=document.createElement('div');subEl.className='learn-item-sub';subEl.textContent=sub;barWrap.appendChild(subEl)}
  var bar=document.createElement('div');bar.className='learn-bar';
  var fill=document.createElement('div');fill.className='learn-bar-fill';fill.style.width=Math.min(pct,100)+'%';fill.style.background=color;
  bar.appendChild(fill);barWrap.appendChild(bar);
  item.appendChild(barWrap);
  var valEl=document.createElement('div');valEl.className='learn-item-val';valEl.style.color=color;valEl.textContent=valText;
  item.appendChild(valEl);
  return item;
}

function makeLearnCard(icon,title,emptyMsg){
  var card=document.createElement('div');card.className='learn-card';
  var titleEl=document.createElement('div');titleEl.className='learn-card-title';
  var iconEl=document.createElement('span');iconEl.className='lc-icon';iconEl.textContent=icon;
  titleEl.appendChild(iconEl);titleEl.appendChild(document.createTextNode(title));
  card.appendChild(titleEl);
  card._empty=emptyMsg;
  return card;
}

function renderLearnCards(d){
  var c=$('#learnCards');c.textContent='';

  var selCard=makeLearnCard('\u26A0','Risky Selectors','No unstable selectors');
  var sels=d.unstableSelectors||[];
  if(!sels.length){var e1=document.createElement('div');e1.className='learn-card-empty';e1.textContent=selCard._empty;selCard.appendChild(e1)}
  else{sels.slice(0,5).forEach(function(s){
    var sel=s.selector.length>40?s.selector.slice(0,37)+'...':s.selector;
    selCard.appendChild(makeLearnItem(sel,s.action_type+' \u00B7 '+s.total_uses+' uses',parseFloat(s.fail_rate),s.fail_rate+'%',parseFloat(s.fail_rate)>30?'var(--red)':'var(--amber)'));
  })}
  c.appendChild(selCard);

  var pageCard=makeLearnCard('\u23F1','Problem Pages','No failing pages');
  var pages=d.failingPages||[];
  if(!pages.length){var e2=document.createElement('div');e2.className='learn-card-empty';e2.textContent=pageCard._empty;pageCard.appendChild(e2)}
  else{pages.slice(0,5).forEach(function(p){
    pageCard.appendChild(makeLearnItem(p.url_path,p.total_visits+' visits \u00B7 '+p.console_errors+' console errs',parseFloat(p.fail_rate),p.fail_rate+'%',parseFloat(p.fail_rate)>30?'var(--red)':'var(--amber)'));
  })}
  c.appendChild(pageCard);

  var flakyCard=makeLearnCard('\u223C','Flaky Tests','No flaky tests detected');
  var flaky=d.flakyTests||[];
  if(!flaky.length){var e3=document.createElement('div');e3.className='learn-card-empty';e3.textContent=flakyCard._empty;flakyCard.appendChild(e3)}
  else{flaky.slice(0,5).forEach(function(f){
    flakyCard.appendChild(makeLearnItem(f.test_name,'Attempt avg '+f.avg_attempts+' \u00B7 '+f.total_runs+' runs',parseFloat(f.flaky_rate),f.flaky_rate+'%',parseFloat(f.flaky_rate)>30?'var(--red)':'var(--amber)'));
  })}
  c.appendChild(flakyCard);

  var apiCard=makeLearnCard('\u21C4','API Issues','No API issues');
  var apis=d.apiIssues||[];
  if(!apis.length){var e4=document.createElement('div');e4.className='learn-card-empty';e4.textContent=apiCard._empty;apiCard.appendChild(e4)}
  else{apis.slice(0,5).forEach(function(a){
    var ep=a.endpoint.length>40?a.endpoint.slice(0,37)+'...':a.endpoint;
    apiCard.appendChild(makeLearnItem(ep,a.total_calls+' calls \u00B7 '+durFmt(a.avg_duration_ms),parseFloat(a.error_rate),a.error_rate+'%',parseFloat(a.error_rate)>20?'var(--red)':'var(--amber)'));
  })}
  c.appendChild(apiCard);
}

function renderLearnTrend(trend){
  var container=$('#learnTrend');container.textContent='';
  if(!trend.length)return;
  var card=document.createElement('div');card.className='learn-card';
  var titleEl=document.createElement('div');titleEl.className='learn-card-title';
  var iconEl=document.createElement('span');iconEl.className='lc-icon';iconEl.textContent='\u2197';
  titleEl.appendChild(iconEl);titleEl.appendChild(document.createTextNode('Pass Rate Trend'));
  card.appendChild(titleEl);
  var chartDiv=document.createElement('div');chartDiv.style.cssText='height:80px;width:100%';
  var w=100/trend.length;var ns='http://www.w3.org/2000/svg';
  var svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none');svg.style.cssText='width:100%;height:100%';
  var bg=document.createElementNS(ns,'rect');bg.setAttribute('x','0');bg.setAttribute('y','0');bg.setAttribute('width','100');bg.setAttribute('height','100');bg.setAttribute('fill','var(--surface2)');bg.setAttribute('rx','2');svg.appendChild(bg);
  var gridLine=document.createElementNS(ns,'line');gridLine.setAttribute('x1','0');gridLine.setAttribute('y1','50');gridLine.setAttribute('x2','100');gridLine.setAttribute('y2','50');gridLine.setAttribute('stroke','var(--border)');gridLine.setAttribute('stroke-width','0.3');gridLine.setAttribute('stroke-dasharray','2,2');svg.appendChild(gridLine);
  var pts=trend.map(function(t,i){return(i*w+w/2)+','+(100-t.pass_rate)}).join(' ');
  var poly=document.createElementNS(ns,'polygon');poly.setAttribute('points',(0*w+w/2)+',100 '+pts+' '+((trend.length-1)*w+w/2)+',100');poly.setAttribute('fill','var(--accent-dim)');svg.appendChild(poly);
  var pl=document.createElementNS(ns,'polyline');pl.setAttribute('points',pts);pl.setAttribute('fill','none');pl.setAttribute('stroke','var(--accent)');pl.setAttribute('stroke-width','1.5');svg.appendChild(pl);
  trend.forEach(function(t,i){
    var color=rateColor(t.pass_rate);
    var circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',''+(i*w+w/2));circle.setAttribute('cy',''+(100-t.pass_rate));circle.setAttribute('r','2.5');circle.setAttribute('fill',color);
    var title=document.createElementNS(ns,'title');title.textContent=t.date+': '+t.pass_rate+'% ('+t.total_tests+' tests)';circle.appendChild(title);svg.appendChild(circle);
  });
  chartDiv.appendChild(svg);card.appendChild(chartDiv);
  var dates=document.createElement('div');dates.style.cssText='display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px';
  dates.appendChild(el('span',null,trend[0].date));dates.appendChild(el('span',null,trend[trend.length-1].date));
  card.appendChild(dates);container.appendChild(card);
}

function renderLearnBottomRow(d){
  var c=$('#learnBottom');c.textContent='';

  var errCard=makeLearnCard('\u2718','Most Common Errors','No errors recorded');
  var errors=d.topErrors||[];
  if(!errors.length){var e1=document.createElement('div');e1.className='learn-card-empty';e1.textContent=errCard._empty;errCard.appendChild(e1)}
  else{errors.slice(0,5).forEach(function(e){
    var pat=e.pattern.length>45?e.pattern.slice(0,42)+'...':e.pattern;
    var maxCount=errors[0].occurrence_count||1;
    var pct=(e.occurrence_count/maxCount)*100;
    var verdictEl=document.createElement('div');verdictEl.className='learn-verdict '+rateClass(100-(pct));verdictEl.textContent=e.category.replace(/-/g,' ');
    var item=makeLearnItem(pat,(e.last_seen||'').split('T')[0]+' \u00B7 '+e.occurrence_count+'x',pct,e.occurrence_count+'x','var(--red)');
    item.insertBefore(verdictEl,item.lastChild);
    errCard.appendChild(item);
  })}
  c.appendChild(errCard);

  var slowCard=makeLearnCard('\u23F3','Slowest Tests','No slow test data');
  var trend=d.recentTrend||[];
  var slowTests=[];
  if(d.flakyTests){
    d.flakyTests.forEach(function(f){
      if(f.avg_duration_ms&&f.avg_duration_ms>2000){slowTests.push({name:f.test_name,dur:f.avg_duration_ms})}
    });
  }
  if(d.failingPages){
    d.failingPages.forEach(function(p){
      if(p.avg_load_time_ms&&p.avg_load_time_ms>3000){slowTests.push({name:p.url_path,dur:p.avg_load_time_ms})}
    });
  }
  slowTests.sort(function(a,b){return b.dur-a.dur});
  if(!slowTests.length){var e2=document.createElement('div');e2.className='learn-card-empty';e2.textContent=slowCard._empty;slowCard.appendChild(e2)}
  else{
    var maxDur=slowTests[0].dur;
    slowTests.slice(0,5).forEach(function(t){
      slowCard.appendChild(makeLearnItem(t.name,'','',durFmt(t.dur),(t.dur/maxDur)*100,t.dur>5000?'var(--red)':'var(--amber)'));
    });
  }
  c.appendChild(slowCard);
}

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

/* ══════════════════════════════════════════════════════════════════
   Screenshot Replay Player — plays a run's per-step screenshots
   as a video. Pulls frames from r.actions[].autoScreenshot|screenshot.
   ══════════════════════════════════════════════════════════════════ */
var REPLAY={frames:[],idx:0,playing:false,speed:1,timer:null,frameMs:1000};

function buildReplayFrames(actions,run){
  var frames=[];
  (actions||[]).forEach(function(a,i){
    var path=a.autoScreenshot||a.screenshot||null;
    frames.push({
      idx:i,
      path:path,
      src:path?'/api/image?path='+encodeURIComponent(path):null,
      type:a.type||'',
      narr:a.narrative||a.type||'',
      duration:a.duration||0,
      success:!!a.success,
    });
  });
  if(run&&!run.success&&run.errorScreenshot){
    frames.push({
      idx:frames.length,
      path:run.errorScreenshot,
      src:'/api/image?path='+encodeURIComponent(run.errorScreenshot),
      type:'failure',
      narr:'Page state at failure',
      duration:0,
      success:false,
    });
  }
  return frames;
}

function openReplay(actions,run){
  REPLAY.frames=buildReplayFrames(actions,run);
  if(!REPLAY.frames.length){showToast&&showToast('No screenshots to replay','warn');return}
  REPLAY.idx=0;REPLAY.playing=false;
  $('#replayModal').classList.add('open');
  $('#replayModal').setAttribute('aria-hidden','false');
  renderReplayFrame();
  // Auto-start playback for the "video" feel
  toggleReplayPlay(true);
}

function closeReplay(){
  stopReplayTimer();
  $('#replayModal').classList.remove('open');
  $('#replayModal').setAttribute('aria-hidden','true');
  // Free image src to avoid lingering downloads
  $('#replayImg').src='';
}

function renderReplayFrame(){
  var f=REPLAY.frames[REPLAY.idx];if(!f)return;
  var modal=$('#replayModal');
  var img=$('#replayImg');
  if(f.src){
    modal.classList.remove('empty');
    if(img.src!==location.origin+f.src&&img.src!==f.src)img.src=f.src;
  }else{
    modal.classList.add('empty');
    img.src='';
  }
  $('#replayStepNum').textContent=(REPLAY.idx+1)+' / '+REPLAY.frames.length;
  $('#replayStepType').textContent=f.type;
  $('#replayStepNarr').textContent=f.narr;
  var pct=REPLAY.frames.length>1?(REPLAY.idx/(REPLAY.frames.length-1))*100:100;
  $('#replayProgressFill').style.width=pct+'%';
}

function scheduleNextReplayFrame(){
  stopReplayTimer();
  if(!REPLAY.playing)return;
  if(REPLAY.idx>=REPLAY.frames.length-1){toggleReplayPlay(false);return}
  // Uniform pacing: 1 frame per second at 1x, scaled by speed.
  var ms=REPLAY.frameMs/REPLAY.speed;
  REPLAY.timer=setTimeout(function(){
    REPLAY.idx++;
    renderReplayFrame();
    scheduleNextReplayFrame();
  },ms);
}

function stopReplayTimer(){if(REPLAY.timer){clearTimeout(REPLAY.timer);REPLAY.timer=null}}

function toggleReplayPlay(forceState){
  REPLAY.playing=typeof forceState==='boolean'?forceState:!REPLAY.playing;
  // If we're at the last frame and user hits play, restart from 0
  if(REPLAY.playing&&REPLAY.idx>=REPLAY.frames.length-1){REPLAY.idx=0;renderReplayFrame()}
  var btn=$('#replayPlay');if(btn)btn.innerHTML=REPLAY.playing?'❙❙':'▶';
  if(REPLAY.playing)scheduleNextReplayFrame();else stopReplayTimer();
}

function stepReplay(delta){
  stopReplayTimer();
  REPLAY.idx=Math.max(0,Math.min(REPLAY.frames.length-1,REPLAY.idx+delta));
  renderReplayFrame();
  if(REPLAY.playing)scheduleNextReplayFrame();
}

function setReplaySpeed(s){
  REPLAY.speed=s;
  document.querySelectorAll('.replay-speed-btn').forEach(function(b){
    b.classList.toggle('active',parseFloat(b.dataset.speed)===s);
  });
  if(REPLAY.playing){stopReplayTimer();scheduleNextReplayFrame()}
}

// Wire up controls
$('#replayPlay').addEventListener('click',function(){toggleReplayPlay()});
$('#replayPrev').addEventListener('click',function(){stepReplay(-1)});
$('#replayNext').addEventListener('click',function(){stepReplay(1)});
$('#replayClose').addEventListener('click',closeReplay);
document.querySelectorAll('.replay-speed-btn').forEach(function(b){
  b.addEventListener('click',function(){setReplaySpeed(parseFloat(b.dataset.speed))});
});
document.addEventListener('keydown',function(e){
  if(!$('#replayModal').classList.contains('open'))return;
  if(e.key==='Escape'){closeReplay()}
  else if(e.key===' '){e.preventDefault();toggleReplayPlay()}
  else if(e.key==='ArrowLeft'){stepReplay(-1)}
  else if(e.key==='ArrowRight'){stepReplay(1)}
});
// Click on stage advances; click outside the image closes
$('#replayModal').addEventListener('click',function(e){
  if(e.target&&e.target.id==='replayModal')closeReplay();
});

// Expose to the renderer below so the storyline header can wire its button
window.openReplay=openReplay;

/* ══════════════════════════════════════════════════════════════════
   Network tab — cross-run network query (Investigate › Network)
   ══════════════════════════════════════════════════════════════════ */
function refreshNetwork(){
  var box=$('#netResults');var empty=$('#networkEmpty');
  if(!box)return;
  box.textContent='';
  box.appendChild(el('div',{style:'padding:20px;text-align:center;color:var(--text3);font-size:11px'},'Loading...'));
  var runsUrl=S.project?'/api/db/projects/'+S.project+'/runs':'/api/db/runs';
  api(runsUrl).then(function(runs){
    if(!Array.isArray(runs)||runs.length===0){
      box.textContent='';if(empty)empty.style.display='block';return;
    }
    if(empty)empty.style.display='none';
    var top=runs.slice(0,30);
    var promises=top.map(function(r){
      return api('/api/db/runs/'+r.id+'/network-logs').catch(function(){return []}).then(function(logs){
        return {run:r,logs:Array.isArray(logs)?logs:[]};
      });
    });
    Promise.all(promises).then(function(results){renderNetworkResults(box,results)});
  }).catch(function(){box.textContent='';if(empty)empty.style.display='block'});
}

function renderNetworkResults(box,results){
  var statusFilter=$('#netStatusFilter')?$('#netStatusFilter').value:'errors';
  var urlFilter=($('#netUrlFilter')?$('#netUrlFilter').value:'').toLowerCase().trim();
  var rows=[];
  results.forEach(function(r){
    r.logs.forEach(function(n){
      var s=n.status||0;
      var keep=true;
      if(statusFilter==='errors')keep=s>=400||s===0;
      else if(statusFilter==='slow')keep=(n.duration||0)>=1000;
      if(keep&&urlFilter&&(n.url||'').toLowerCase().indexOf(urlFilter)<0)keep=false;
      if(keep)rows.push({run:r.run,n:n});
    });
  });
  box.textContent='';
  if(rows.length===0){
    box.appendChild(el('div',{style:'padding:30px;text-align:center;color:var(--text3);font-size:11px'},'No matching network records.'));
    return;
  }
  rows.sort(function(a,b){return (b.n.duration||0)-(a.n.duration||0)});
  var head=el('div',{className:'net-row net-head'},[
    el('span',{className:'net-col-run'},'Run'),
    el('span',{className:'net-col-method'},'Method'),
    el('span',{className:'net-col-status'},'Status'),
    el('span',{className:'net-col-url'},'URL'),
    el('span',{className:'net-col-dur'},'Duration')
  ]);
  box.appendChild(head);
  rows.slice(0,200).forEach(function(rr){
    var n=rr.n;var s=n.status||0;
    var sCls=s===0?'s5xx':s<300?'s2xx':s<400?'s3xx':s<500?'s4xx':'s5xx';
    var mCls=(n.method||'GET').toLowerCase();
    var row=el('div',{className:'net-row clickable',onclick:function(){
      showView('investigate');
      var btn=document.querySelector('.tab-btn[data-tab="runsTabHistory"]');if(btn)btn.click();
    }},[
      el('span',{className:'net-col-run'},'#'+rr.run.id),
      el('span',{className:'net-col-method m-'+mCls},n.method||'GET'),
      el('span',{className:'net-col-status st-'+sCls},String(s||'ERR')),
      el('span',{className:'net-col-url',title:n.url||''},n.url||''),
      el('span',{className:'net-col-dur'},dur(n.duration||0))
    ]);
    box.appendChild(row);
  });
  if(rows.length>200){
    box.appendChild(el('div',{style:'padding:10px;text-align:center;color:var(--text3);font-size:11px'},'Showing 200 of '+rows.length+' results'));
  }
}

(function(){
  var btn=$('#btnRefreshNetwork');if(btn)btn.addEventListener('click',refreshNetwork);
  var sel=$('#netStatusFilter');if(sel)sel.addEventListener('change',refreshNetwork);
  var inp=$('#netUrlFilter');
  if(inp){
    var deb;
    inp.addEventListener('input',function(){clearTimeout(deb);deb=setTimeout(refreshNetwork,200)});
  }
  // Lazy: only fetch first time the Network tab is clicked
  var netTabBtn=document.querySelector('.tab-btn[data-tab="investigateTabNetwork"]');
  if(netTabBtn){
    netTabBtn.addEventListener('click',function(){
      if(!netTabBtn.dataset.loaded){netTabBtn.dataset.loaded='1';refreshNetwork()}
    });
  }
})();
