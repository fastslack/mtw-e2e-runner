/* ── Global State ── */
var S={
  ws:null,project:null,view:'overview',selectedRun:null,
  liveRuns:{},liveCollapsed:new Set(),liveSSOpen:new Set(),
  runFilter:{status:'all',search:''},
  lastLearningsData:null,
  highlightedRunIdx:-1,
  testsSearch:'',testsExpanded:new Set(),
  /* Screencast selection: {runId, name} | null. Composite to avoid name
     collisions between concurrent runs. When null, the live preview
     auto-follows the most recent frame from any running test. */
  screencastSel:null,
  /* Auto-follow latest frame when no test is explicitly pinned. */
  screencastAuto:true,
  /* {runId, name} of the test whose frame is currently shown in auto mode. */
  screencastLast:null,
  /* Ring buffer of recent frames for the filmstrip: {src, name, ts}. */
  screencastFilm:[],
  _filmTs:0
};
function screencastKey(s){return s?(s.runId+'::'+s.name):null}

/* ── Section labels (used in top bar breadcrumb) ── */
var VIEW_LABELS={
  overview:'Overview',
  live:'Live',
  run:'Run',
  investigate:'Investigate',
  insights:'Insights',
  tools:'Tools'
};

/* ── Navigation ──
   Nav items may carry an optional data-tab attribute that activates
   a sub-tab inside the destination view (used by promoted sub-items
   like Suites/Modules/Variables under "Test Definitions"). */
$$('.nav-item').forEach(function(n){
  n.addEventListener('click',function(){
    showView(n.dataset.view,n.dataset.tab);
  });
});
function showView(v,subTab){
  S.view=v;
  // Match active state by (view + optional tab) so sub-items don't all light
  // up just because they share the same parent view.
  $$('.nav-item').forEach(function(n){
    var sameView=n.dataset.view===v;
    var sameTab=(n.dataset.tab||'')===(subTab||'');
    n.classList.toggle('active',sameView&&sameTab);
  });
  $$('.view').forEach(function(x){x.classList.remove('active')});
  var viewEl=$('#view-'+v);
  if(viewEl)viewEl.classList.add('active');
  // Activate the requested sub-tab inside the view
  if(subTab&&viewEl){
    var btn=viewEl.querySelector('.tab-btn[data-tab="'+subTab+'"]');
    if(btn&&!btn.classList.contains('active'))btn.click();
  }
  if(v==='overview'&&typeof startWatchPolling==='function')startWatchPolling();
  else if(typeof stopWatchPolling==='function')stopWatchPolling();
  // Re-render Live when switching to it so empty/active panel state matches reality
  if(v==='live'&&typeof renderLive==='function')renderLive();
  updateBreadcrumb();
}

/* ── Breadcrumb (top bar) ── */
function updateBreadcrumb(subLabel){
  var bc=$('#topbarBreadcrumb');if(!bc)return;
  var label=VIEW_LABELS[S.view]||S.view;
  bc.textContent='';
  bc.appendChild(el('span',{className:'topbar-section'},label));
  if(subLabel){
    bc.appendChild(el('span',{className:'topbar-sep'},'›'));
    bc.appendChild(el('span',{className:'topbar-subsection'},subLabel));
  }
}

/* ── Inner Tabs ── */
function initTabs(){
  $$('.tab-bar').forEach(function(bar){
    var container=bar.parentElement;
    bar.querySelectorAll('.tab-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        bar.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active')});
        btn.classList.add('active');
        container.querySelectorAll('.tab-pane').forEach(function(p){p.classList.remove('active')});
        var pane=container.querySelector('#'+btn.dataset.tab);
        if(pane)pane.classList.add('active');
        var label=(btn.firstChild&&btn.firstChild.nodeType===3?btn.firstChild.nodeValue:btn.textContent).trim();
        updateBreadcrumb(label);
      });
    });
  });
}
