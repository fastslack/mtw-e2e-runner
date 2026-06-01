/* ══════════════════════════════════════════════════════════════════
   Init — startup sequence
   ══════════════════════════════════════════════════════════════════ */
initTabs();
connectWS();
refreshStatus();
refreshProjects();
refreshSuites();
refreshRuns();
refreshScreenshots();
refreshLearnings();
refreshVariables();
startWatchPolling();
updateBreadcrumb();
syncTopbarLive(false,0,0);
if(typeof refreshTodayTelemetry==='function'){
  refreshTodayTelemetry();
  setInterval(refreshTodayTelemetry,30000);
}
// Keep pool telemetry fresh independent of the WS pool stream
setInterval(refreshStatus,8000);

/* ── Top bar handlers ── */
(function(){
  var liveBtn=$('#topbarLive');
  if(liveBtn)liveBtn.addEventListener('click',function(){showView('live')});
  var runBtn=$('#topbarRunBtn');
  if(runBtn)runBtn.addEventListener('click',function(){
    if(typeof triggerRun==='function')triggerRun();
  });
})();

/* ── Screencast toggle persistence (default ON) ── */
(function(){
  var sc=$('#screencastToggle');
  if(!sc)return;
  var saved=null;try{saved=localStorage.getItem('e2e-screencast')}catch(e){}
  sc.checked=saved===null?true:saved==='1';
  sc.addEventListener('change',function(){try{localStorage.setItem('e2e-screencast',sc.checked?'1':'0')}catch(e){}});
})();

/* ── Theme toggle ── */
(function(){
  var btn=$('#themeToggle');
  var lbl=$('#themeToggleLabel');
  if(!btn)return;
  function syncLabel(){
    var t=document.documentElement.getAttribute('data-theme')||'dark';
    if(lbl)lbl.textContent=(t==='dark'?'Light':'Dark');
  }
  syncLabel();
  btn.addEventListener('click',function(){
    var cur=document.documentElement.getAttribute('data-theme')||'dark';
    var next=cur==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',next);
    try{localStorage.setItem('e2e-theme',next)}catch(e){}
    syncLabel();
  });
})();
