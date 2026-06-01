/* ══════════════════════════════════════════════════════════════════
   Tests View — Suites + Modules + Variables (inner tabs)
   ══════════════════════════════════════════════════════════════════ */
function refreshSuites(){
  var grid=$('#suiteGrid'),empty=$('#suitesEmpty'),accordion=$('#suiteAccordionContainer');
  grid.textContent='';
  accordion.textContent='';
  var moduleSection=$('#moduleSection');
  moduleSection.textContent='';
  var toolbar=$('#suitesToolbar');

  if(S.project){
    // Keep the toolbar visible so users can still search suites within a
    // single project — only the expand/collapse buttons are dropped since
    // there are no project accordions to expand in single-project view.
    if(toolbar){
      toolbar.style.display='';
      toolbar.classList.add('single-project');
    }
    api('/api/db/projects/'+S.project+'/suites').then(function(suites){
      if(!Array.isArray(suites)||suites.length===0){empty.style.display='block';empty.querySelector('p').textContent='No test suites found for this project.';return}
      empty.style.display='none';
      $('#badgeSuites').textContent=suites.length;
      renderSuiteCards(grid,suites,S.project);
      applyTestsSearch();
    }).catch(function(){});
    api('/api/db/projects/'+S.project+'/modules').then(function(modules){
      renderModules(moduleSection,modules);
      applyTestsSearch();
    }).catch(function(){});
  } else {
    if(toolbar){toolbar.style.display='';toolbar.classList.remove('single-project')}
    api('/api/db/projects').then(function(projects){
      if(!Array.isArray(projects)||projects.length===0){empty.style.display='block';empty.querySelector('p').textContent='No projects registered yet.';return}
      var sorted=projects.slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'')});
      var pending=sorted.length,results=[];
      sorted.forEach(function(p,idx){
        api('/api/db/projects/'+p.id+'/suites').then(function(suites){
          results[idx]={project:p,suites:Array.isArray(suites)?suites:[]};
        }).catch(function(){
          results[idx]={project:p,suites:[]};
        }).then(function(){
          pending--;
          if(pending===0)renderAllProjectAccordions(results);
        });
      });
    }).catch(function(){});
  }
}

function renderAllProjectAccordions(results){
  var container=$('#suiteAccordionContainer');
  var empty=$('#suitesEmpty');
  container.textContent='';
  var withSuites=results.filter(function(r){return r.suites.length>0});
  var totalSuites=withSuites.reduce(function(s,r){return s+r.suites.length},0);
  $('#badgeSuites').textContent=totalSuites;
  if(withSuites.length===0){empty.style.display='block';empty.querySelector('p').textContent='No test suites found.';return}
  empty.style.display='none';
  var autoExpand=withSuites.length===1;
  withSuites.forEach(function(r){
    renderProjectAccordion(container,r.project,r.suites,autoExpand||S.testsExpanded.has(r.project.id));
  });
  applyTestsSearch();
}

function renderProjectAccordion(container,project,suites,startOpen){
  var totalTests=suites.reduce(function(sum,s){return sum+(s.testCount||0)},0);
  var body=el('div',{className:'project-accordion-body'});
  var innerGrid=el('div',{className:'suite-grid'});
  renderSuiteCards(innerGrid,suites,project.id);
  body.appendChild(innerGrid);

  var header=el('div',{className:'project-accordion-header'},[
    el('span',{className:'project-accordion-chevron'},'\u25B6'),
    el('span',{className:'project-accordion-name'},project.name),
    el('div',{className:'project-accordion-meta'},[
      el('span',{className:'project-accordion-badge'},suites.length+(suites.length===1?' suite':' suites')),
      el('span',{className:'project-accordion-badge'},totalTests+(totalTests===1?' test':' tests'))
    ])
  ]);

  var wrapper=el('div',{className:'project-accordion'},[header,body]);
  wrapper.dataset.projectId=String(project.id);
  wrapper.dataset.projectName=(project.name||'').toLowerCase();
  if(startOpen)wrapper.classList.add('open');
  header.addEventListener('click',function(){
    wrapper.classList.toggle('open');
    if(wrapper.classList.contains('open'))S.testsExpanded.add(project.id);
    else S.testsExpanded.delete(project.id);
  });
  container.appendChild(wrapper);
}

/* ── Search / filter ── */
function applyTestsSearch(){
  var q=(S.testsSearch||'').trim().toLowerCase();
  // Single-project mode: filter suite cards in #suiteGrid + module cards
  // in #moduleSection. The toolbar count reflects both.
  if(S.project){
    var visSuites=0,visModules=0;
    $$('#suiteGrid .suite-card').forEach(function(card){
      var sname=(card.dataset.suiteName||'').toLowerCase();
      var tests=card.querySelectorAll('.suite-card-tests li');
      var testHit=false;
      tests.forEach(function(li){
        var raw=(li.firstChild&&li.firstChild.nodeType===3?li.firstChild.nodeValue:li.textContent)||'';
        var tname=raw.toLowerCase();
        var matches=!q||sname.indexOf(q)>=0||tname.indexOf(q)>=0;
        li.style.display=matches?'':'none';
        if(q&&tname.indexOf(q)>=0)testHit=true;
      });
      var show=!q||sname.indexOf(q)>=0||testHit;
      card.style.display=show?'':'none';
      if(show)visSuites++;
    });
    $$('#moduleSection .module-card').forEach(function(card){
      var nm=(card.querySelector('.module-card-name')?.textContent||'').toLowerCase();
      var desc=(card.querySelector('.module-card-desc')?.textContent||'').toLowerCase();
      var show=!q||nm.indexOf(q)>=0||desc.indexOf(q)>=0;
      card.style.display=show?'':'none';
      if(show)visModules++;
    });
    var t=$('#module-section-title')||document.querySelector('.module-section-title');
    var countEl=$('#suitesToolbarCount');
    if(countEl){
      if(q)countEl.textContent=visSuites+' suites · '+visModules+' modules';
      else countEl.textContent='';
    }
    return;
  }
  // Multi-project (All Projects) mode: filter accordions and their children
  var accordions=$$('#suiteAccordionContainer .project-accordion');
  var visibleProjects=0,visibleSuites=0;

  accordions.forEach(function(acc){
    var pname=acc.dataset.projectName||'';
    var projectMatches=q&&pname.indexOf(q)>=0;
    var anySuiteVisible=false;
    var cards=acc.querySelectorAll('.suite-card');
    cards.forEach(function(card){
      var sname=(card.dataset.suiteName||'').toLowerCase();
      var tests=card.querySelectorAll('.suite-card-tests li');
      var testMatches=0;
      tests.forEach(function(li){
        var raw=(li.firstChild&&li.firstChild.nodeType===3?li.firstChild.nodeValue:li.textContent)||'';
        var tname=raw.toLowerCase();
        var matches=!q||projectMatches||sname.indexOf(q)>=0||tname.indexOf(q)>=0;
        li.style.display=matches?'':'none';
        if(matches&&q&&tname.indexOf(q)>=0)testMatches++;
      });
      var suiteVisible=!q||projectMatches||sname.indexOf(q)>=0||testMatches>0;
      card.style.display=suiteVisible?'':'none';
      if(suiteVisible){anySuiteVisible=true;visibleSuites++}
    });
    var projectVisible=!q||projectMatches||anySuiteVisible;
    acc.style.display=projectVisible?'':'none';
    if(projectVisible)visibleProjects++;
    if(q&&projectVisible&&anySuiteVisible)acc.classList.add('open');
    else if(q&&!projectVisible)acc.classList.remove('open');
  });

  var countEl=$('#suitesToolbarCount');
  if(countEl){
    if(q)countEl.textContent=visibleSuites+' suites · '+visibleProjects+' projects';
    else countEl.textContent='';
  }
}

function setSuiteAccordionsOpen(open){
  $$('#suiteAccordionContainer .project-accordion').forEach(function(acc){
    if(acc.style.display==='none')return;
    acc.classList.toggle('open',!!open);
    var pid=parseInt(acc.dataset.projectId,10);
    if(!isNaN(pid)){
      if(open)S.testsExpanded.add(pid);
      else S.testsExpanded.delete(pid);
    }
  });
}

/* ── Suite Modal ── */
var _suiteCache={};

function openSuiteModal(suiteName,projectId){
  var overlay=$('#suiteModalOverlay');
  var body=$('#suiteModalBody');
  $('#suiteModalName').textContent=suiteName;
  $('#suiteModalFile').textContent=suiteName+'.json';
  body.textContent='';
  body.appendChild(el('div',{className:'suite-modal-loading'},'Loading\u2026'));
  overlay.classList.add('open');

  $('#suiteModalRun').onclick=function(){triggerRun(suiteName,projectId)};
  $('#suiteModalClose').onclick=function(){overlay.classList.remove('open')};
  overlay.addEventListener('click',function(e){if(e.target===overlay)overlay.classList.remove('open')});

  var cacheKey=projectId+'::'+suiteName;
  var p=_suiteCache[cacheKey]||api('/api/db/projects/'+projectId+'/suites/'+encodeURIComponent(suiteName));
  _suiteCache[cacheKey]=p;
  p.then(function(data){
    body.textContent='';
    if(!data||!data.tests||!data.tests.length){
      body.appendChild(el('div',{className:'suite-modal-loading'},'No tests found'));
      return;
    }
    data.tests.forEach(function(test){
      var actionsDiv=el('div',{className:'suite-modal-test-actions'});
      (test.actions||[]).forEach(function(a,i){
        var detailContent;
        if(a.selector&&(a.value||a.text)){
          detailContent=[el('span',{className:'step-sel'},a.selector),el('span',{className:'step-arrow'},'\u2192'),el('span',{className:'step-val'},a.text||a.value)];
        } else {
          detailContent=a.selector||a.value||a.text||'';
        }
        actionsDiv.appendChild(el('div',{className:'suite-modal-step'},[
          el('span',{className:'suite-modal-step-num'},String(i+1)),
          el('span',{className:'suite-modal-step-type'},a.type),
          el('span',{className:'suite-modal-step-detail'},detailContent)
        ]));
      });

      var header=el('div',{className:'suite-modal-test-header'},[
        el('span',{className:'suite-modal-test-chevron'},'\u25B6'),
        el('span',{className:'suite-modal-test-name'},test.name),
        el('span',{className:'suite-modal-test-badge'},(test.actions||[]).length+' actions')
      ]);

      var testEl=el('div',{className:'suite-modal-test'},[header,actionsDiv]);
      if(test.expect){
        var expectText=Array.isArray(test.expect)?test.expect.join(', '):test.expect;
        var expectEl=el('div',{className:'suite-modal-expect'},[
          el('span',{className:'suite-modal-expect-label'},'Expect:'),
          document.createTextNode(expectText)
        ]);
        testEl.insertBefore(expectEl,actionsDiv);
      }
      header.addEventListener('click',function(){testEl.classList.toggle('open')});
      body.appendChild(testEl);
    });
  }).catch(function(){
    body.textContent='';
    body.appendChild(el('div',{className:'suite-modal-loading',style:'color:var(--red)'},'Failed to load suite'));
  });
}

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

    var cardHead=el('div',{className:'suite-card-head',style:'cursor:pointer'},[
      el('div',{className:'suite-card-icon'},'\u25B6'),
      el('div',{className:'suite-card-info'},[
        el('div',{className:'suite-card-name'},s.name),
        el('div',{className:'suite-card-file'},s.file||s.name+'.json')
      ]),
      el('div',{className:'suite-card-count'},[
        el('div',{className:'suite-card-count-num'},String(s.testCount||0)),
        el('div',{className:'suite-card-count-lbl'},'tests')
      ])
    ]);
    (function(name,projId){
      cardHead.addEventListener('click',function(){openSuiteModal(name,projId)});
    })(s.name,pid);

    var card=el('div',{className:'suite-card'},[
      cardHead,
      el('div',{className:'suite-card-body'},[tests]),
      el('div',{className:'suite-card-footer'},[
        el('button',{className:'btn sm primary',onclick:function(){triggerRun(s.name,pid)}},'Run Suite')
      ])
    ]);
    card.dataset.suiteName=s.name;
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

/* ── Variables ── */
function refreshVariables(){
  var container=$('#variablesContainer'),empty=$('#variablesEmpty');
  container.textContent='';
  if(!S.project){empty.style.display='block';empty.querySelector('p').textContent='Select a project to manage variables.';return}
  api('/api/db/projects/'+S.project+'/variables').then(function(vars){
    if(!Array.isArray(vars)||!vars.length){empty.style.display='block';empty.querySelector('p').textContent='No variables set. Add variables to use {{var.KEY}} in your tests.';return}
    empty.style.display='none';
    renderVariables(vars);
  }).catch(function(){empty.style.display='block'});
}

function renderVariables(vars){
  var container=$('#variablesContainer');
  var tbl=el('table',{className:'var-table'});
  var thead=document.createElement('thead');
  var hr=document.createElement('tr');
  ['Key','Value','Scope','Actions'].forEach(function(h){hr.appendChild(el('th',null,h))});
  thead.appendChild(hr);tbl.appendChild(thead);
  var tbody=document.createElement('tbody');
  vars.forEach(function(v){
    var tr=document.createElement('tr');
    tr.appendChild(el('td',null,[el('code',null,v.key)]));
    tr.appendChild(el('td',{style:'max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'},v.is_secret?'\u2022\u2022\u2022\u2022\u2022\u2022':v.value));
    tr.appendChild(el('td',{style:'color:var(--text3)'},v.scope||'project'));
    var delBtn=el('button',{className:'btn sm danger',onclick:function(){
      if(!confirm('Delete variable "'+v.key+'"?'))return;
      fetch('/api/db/projects/'+S.project+'/variables/'+encodeURIComponent(v.key),{method:'DELETE'}).then(function(){refreshVariables();showToast('Variable deleted','success')}).catch(function(){showToast('Delete failed','error')});
    }},'\u2715');
    tr.appendChild(el('td',null,[delBtn]));
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  container.appendChild(tbl);
}

/* ── Variable Add Form ── */
$('#btnAddVar').addEventListener('click',function(){
  var form=$('#varAddForm');
  if(form.style.display==='none'){
    form.style.display='';
    form.textContent='';
    var keyInput=el('input',{type:'text',placeholder:'KEY',style:'margin-right:8px;width:120px'});
    var valInput=el('input',{type:'text',placeholder:'Value',style:'margin-right:8px;width:200px'});
    var secretCheck=el('input',{type:'checkbox',style:'margin-right:4px'});
    var saveBtn=el('button',{className:'btn sm primary',onclick:function(){
      var k=keyInput.value.trim(),v=valInput.value;
      if(!k){showToast('Key is required','error');return}
      if(!S.project){showToast('Select a project first','error');return}
      fetch('/api/db/projects/'+S.project+'/variables',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k,value:v,is_secret:secretCheck.checked})}).then(function(r){return r.json()}).then(function(){
        form.style.display='none';refreshVariables();showToast('Variable saved','success');
      }).catch(function(){showToast('Save failed','error')});
    }},'Save');
    var cancelBtn=el('button',{className:'btn sm',onclick:function(){form.style.display='none'}},'Cancel');
    form.appendChild(el('div',{className:'var-add-form',style:'display:flex;align-items:center;gap:8px;flex-wrap:wrap'},[
      keyInput,valInput,
      el('label',{style:'font-size:11px;color:var(--text2);display:flex;align-items:center;gap:4px'},[secretCheck,document.createTextNode('Secret')]),
      saveBtn,cancelBtn
    ]));
  } else {
    form.style.display='none';
  }
});

$('#btnRunAll').addEventListener('click',function(){triggerRun()});

/* ── Tests toolbar (search + expand/collapse all) ── */
(function(){
  var input=$('#suitesSearchInput');
  if(input){
    var debounce;
    input.addEventListener('input',function(){
      clearTimeout(debounce);
      debounce=setTimeout(function(){
        S.testsSearch=input.value||'';
        applyTestsSearch();
      },90);
    });
    input.addEventListener('keydown',function(e){
      if(e.key==='Escape'){input.value='';S.testsSearch='';applyTestsSearch()}
    });
  }
  var bExp=$('#btnExpandAllSuites');
  if(bExp)bExp.addEventListener('click',function(){setSuiteAccordionsOpen(true)});
  var bCol=$('#btnCollapseAllSuites');
  if(bCol)bCol.addEventListener('click',function(){setSuiteAccordionsOpen(false)});
})();
