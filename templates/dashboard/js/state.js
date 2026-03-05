/* ── Global State ── */
var S={
  ws:null,project:null,view:'watch',selectedRun:null,
  liveRuns:{},liveCollapsed:new Set(),liveSSOpen:new Set(),
  runFilter:{status:'all',search:''},
  lastLearningsData:null,
  highlightedRunIdx:-1
};

/* ── Navigation ── */
$$('.nav-item').forEach(function(n){
  n.addEventListener('click',function(){
    showView(n.dataset.view);
  });
});
function showView(v){
  S.view=v;
  $$('.nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.view===v)});
  $$('.view').forEach(function(x){x.classList.remove('active')});
  var viewEl=$('#view-'+v);
  if(viewEl)viewEl.classList.add('active');
  if(v==='watch'&&typeof startWatchPolling==='function')startWatchPolling();
  else if(typeof stopWatchPolling==='function')stopWatchPolling();
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
      });
    });
  });
}
