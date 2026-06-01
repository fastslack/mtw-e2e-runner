/* ══════════════════════════════════════════════════════════════════
   Quick Search palette — Ctrl/⌘+K (or /) to open, searches across
   suites, tests within suites, and reusable modules. Jumps to the
   right view + tab on Enter / click.
   ══════════════════════════════════════════════════════════════════ */

var QS = { index: [], filtered: [], active: 0, lastFetch: 0 };

function qsModalEl(){return document.getElementById('qsModal')}
function qsOpen(){
  var m=qsModalEl();if(!m)return;
  m.classList.add('open');m.setAttribute('aria-hidden','false');
  var inp=document.getElementById('qsInput');
  if(inp){inp.value='';inp.focus()}
  // Refresh index opportunistically (cached for 20s)
  if(Date.now()-QS.lastFetch>20000)qsBuildIndex();
  else qsRender('');
}
function qsClose(){
  var m=qsModalEl();if(!m)return;
  m.classList.remove('open');m.setAttribute('aria-hidden','true');
}

/* Build a flat index of suites, modules and tests across all projects. */
function qsBuildIndex(){
  var empty=document.getElementById('qsEmpty');
  if(empty)empty.textContent='Loading index...';
  api('/api/db/projects').then(function(projects){
    if(!Array.isArray(projects))projects=[];
    var pending=projects.length*2;
    if(pending===0){QS.index=[];QS.lastFetch=Date.now();qsRender('');return}
    var idx=[];
    projects.forEach(function(proj){
      api('/api/db/projects/'+proj.id+'/suites').then(function(suites){
        if(Array.isArray(suites)){
          suites.forEach(function(s){
            idx.push({
              kind:'suite',
              name:s.name,
              sub:proj.name,
              meta:(s.testCount||0)+' tests',
              project:proj,
              suite:s,
            });
            (s.tests||[]).forEach(function(t){
              idx.push({
                kind:'test',
                name:t.name||'(unnamed test)',
                sub:proj.name+' › '+s.name,
                meta:(t.actionCount||(t.actions&&t.actions.length)||0)+' steps',
                project:proj,
                suite:s,
                test:t,
              });
            });
          });
        }
      }).catch(function(){}).then(function(){
        pending--;if(pending===0){QS.index=idx;QS.lastFetch=Date.now();qsRender('')}
      });
      api('/api/db/projects/'+proj.id+'/modules').then(function(modules){
        if(Array.isArray(modules)){
          modules.forEach(function(m){
            idx.push({
              kind:'module',
              name:m.name,
              sub:proj.name+(m.description?' — '+m.description:''),
              meta:(m.actionCount||0)+' actions'+(m.params&&m.params.length?' · '+m.params.length+' params':''),
              project:proj,
              module:m,
            });
          });
        }
      }).catch(function(){}).then(function(){
        pending--;if(pending===0){QS.index=idx;QS.lastFetch=Date.now();qsRender('')}
      });
    });
  }).catch(function(){
    QS.index=[];QS.lastFetch=Date.now();qsRender('');
  });
}

/* Fuzzy-ish scoring: subsequence match + bonuses for word starts and exact. */
function qsScore(text,q){
  if(!q)return 0;
  text=(text||'').toLowerCase();q=q.toLowerCase();
  if(text===q)return 1000;
  if(text.indexOf(q)===0)return 700;
  var i=text.indexOf(q);
  if(i>=0){
    // Word-boundary bonus
    var prev=i>0?text.charAt(i-1):'';
    var wb=prev===' '||prev==='-'||prev==='_'||prev==='.'||prev==='/'||prev===':';
    return 400+(wb?80:0);
  }
  // Subsequence fallback
  var ti=0,qi=0;
  while(ti<text.length&&qi<q.length){
    if(text.charAt(ti)===q.charAt(qi))qi++;
    ti++;
  }
  return qi===q.length?100:0;
}

function qsEscape(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function qsHighlight(name,q){
  if(!q)return name;
  var lc=name.toLowerCase();var lq=q.toLowerCase();
  var i=lc.indexOf(lq);
  if(i<0)return name;
  return name.slice(0,i)+'<mark>'+name.slice(i,i+q.length)+'</mark>'+name.slice(i+q.length);
}

function qsRender(q){
  var results=document.getElementById('qsResults');
  var empty=document.getElementById('qsEmpty');
  var modal=qsModalEl();if(!results||!modal)return;
  results.textContent='';
  if(!QS.index.length){
    modal.classList.remove('has-results');
    if(empty)empty.textContent=QS.lastFetch?'No suites or modules indexed yet.':'Loading index...';
    QS.filtered=[];QS.active=0;return;
  }
  var query=(q||'').trim();
  var scored=QS.index.map(function(it){
    return {item:it,score:query?qsScore(it.name,query)+0.5*qsScore(it.sub||'',query):1};
  }).filter(function(s){return s.score>0});
  scored.sort(function(a,b){return b.score-a.score});
  var top=scored.slice(0,40);
  if(!top.length){
    modal.classList.remove('has-results');
    if(empty)empty.textContent='No matches for "'+query+'"';
    QS.filtered=[];QS.active=0;return;
  }
  modal.classList.add('has-results');
  QS.filtered=top.map(function(s){return s.item});
  QS.active=0;
  // Group by kind in display
  var groups={suite:[],test:[],module:[]};
  QS.filtered.forEach(function(it,idx){groups[it.kind].push({item:it,idx:idx})});
  var labelMap={suite:'Suites',test:'Tests',module:'Modules'};
  ['suite','test','module'].forEach(function(k){
    if(!groups[k].length)return;
    results.appendChild(el('div',{className:'qs-group-label'},labelMap[k]));
    groups[k].forEach(function(entry){
      var it=entry.item;var idx=entry.idx;
      var nameEl=el('div',{className:'qs-item-name'});
      nameEl.innerHTML=qsHighlight(qsEscape(it.name),qsEscape(query));
      var row=el('div',{className:'qs-item',dataIdx:String(idx)},[
        el('span',{className:'qs-item-kind '+it.kind},it.kind),
        el('div',{className:'qs-item-main'},[
          nameEl,
          el('div',{className:'qs-item-sub'},it.sub||'')
        ]),
        el('span',{className:'qs-item-meta'},it.meta||'')
      ]);
      row.addEventListener('click',function(){qsJump(it)});
      results.appendChild(row);
    });
  });
  qsUpdateActive();
}

function qsUpdateActive(){
  var nodes=document.querySelectorAll('.qs-item');
  nodes.forEach(function(n,i){
    n.classList.toggle('active',i===QS.active);
  });
  var act=nodes[QS.active];
  if(act&&act.scrollIntoView)act.scrollIntoView({block:'nearest'});
}

function qsMove(delta){
  if(!QS.filtered.length)return;
  QS.active=(QS.active+delta+QS.filtered.length)%QS.filtered.length;
  qsUpdateActive();
}

function qsJump(it){
  if(!it)return;
  qsClose();
  // Set project selector if needed
  if(it.project&&S.project!==it.project.id){
    var sel=document.getElementById('projectSelect');
    if(sel){
      sel.value=String(it.project.id);
      S.project=it.project.id;
      if(typeof S.selectedRun!=='undefined')S.selectedRun=null;
      // Trigger refresh chain
      if(typeof refreshSuites==='function')refreshSuites();
      if(typeof refreshRuns==='function')refreshRuns();
      if(typeof refreshScreenshots==='function')refreshScreenshots();
      if(typeof refreshLearnings==='function')refreshLearnings();
      if(typeof refreshVariables==='function')refreshVariables();
    }
  }
  // Route to the correct view + tab
  if(it.kind==='suite'||it.kind==='test'){
    showView('run','testsTabSuites');
    setTimeout(function(){qsScrollToSuite(it)},250);
  }else if(it.kind==='module'){
    showView('run','testsTabModules');
    setTimeout(function(){qsScrollToModule(it)},250);
  }
}

function qsScrollToSuite(it){
  if(!it||!it.suite)return;
  var name=(it.suite.name||'').toLowerCase();
  var cards=document.querySelectorAll('.suite-card');
  for(var i=0;i<cards.length;i++){
    var n=(cards[i].dataset.suiteName||cards[i].textContent||'').toLowerCase();
    if(n.indexOf(name)>=0){
      cards[i].scrollIntoView({behavior:'smooth',block:'center'});
      cards[i].classList.add('qs-flash');
      setTimeout(function(c){return function(){c.classList.remove('qs-flash')}}(cards[i]),1500);
      // If user wanted a test, also click the suite card to open its modal
      if(it.kind==='test'&&cards[i].click)cards[i].click();
      return;
    }
  }
}
function qsScrollToModule(it){
  if(!it||!it.module)return;
  var name=(it.module.name||'').toLowerCase();
  var cards=document.querySelectorAll('.module-card');
  for(var i=0;i<cards.length;i++){
    var n=(cards[i].textContent||'').toLowerCase();
    if(n.indexOf(name)===0||(' '+n).indexOf(' '+name)>=0){
      cards[i].scrollIntoView({behavior:'smooth',block:'center'});
      cards[i].classList.add('qs-flash');
      setTimeout(function(c){return function(){c.classList.remove('qs-flash')}}(cards[i]),1500);
      return;
    }
  }
}

/* Wire up triggers + keyboard */
(function(){
  var inp=document.getElementById('qsInput');
  if(inp){
    inp.addEventListener('input',function(){qsRender(inp.value)});
    inp.addEventListener('keydown',function(e){
      if(e.key==='ArrowDown'){e.preventDefault();qsMove(1)}
      else if(e.key==='ArrowUp'){e.preventDefault();qsMove(-1)}
      else if(e.key==='Enter'){
        e.preventDefault();
        var it=QS.filtered[QS.active];if(it)qsJump(it);
      }
      else if(e.key==='Escape'){qsClose()}
    });
  }
  var trigger=document.getElementById('topbarSearchTrigger');
  if(trigger)trigger.addEventListener('click',qsOpen);
  // Backdrop close
  var modal=qsModalEl();
  if(modal){
    modal.addEventListener('click',function(e){
      if(e.target===modal)qsClose();
    });
  }
  // Global keyboard binding
  document.addEventListener('keydown',function(e){
    var typingHere=document.activeElement&&(document.activeElement.tagName==='INPUT'||document.activeElement.tagName==='TEXTAREA'||document.activeElement.isContentEditable);
    var open=modal&&modal.classList.contains('open');
    if((e.metaKey||e.ctrlKey)&&e.key==='k'){
      e.preventDefault();
      if(open)qsClose();else qsOpen();
      return;
    }
    if(!typingHere&&!open&&e.key==='/'){
      e.preventDefault();qsOpen();
    }
  });
})();
