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
