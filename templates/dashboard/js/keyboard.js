/* ══════════════════════════════════════════════════════════════════
   Keyboard Shortcuts (Updated: 1=Watch, 2=Tests, 3=Runs, 4=Live)
   ══════════════════════════════════════════════════════════════════ */
document.addEventListener('keydown',function(e){
  var tag=document.activeElement.tagName;
  if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;
  if(e.key==='Escape'){
    if($('#kbModal').classList.contains('open')){$('#kbModal').classList.remove('open');return}
    if($('#modal').classList.contains('open')){$('#modal').classList.remove('open');return}
    if($('#suiteModalOverlay').classList.contains('open')){$('#suiteModalOverlay').classList.remove('open');return}
    if(S.selectedRun!==null){
      var expanded=document.querySelector('#runsBody tr.expanded');
      if(expanded){
        var next=expanded.nextElementSibling;
        if(next&&next.classList.contains('run-detail-row')){var w=next.querySelector('.rd-wrap');if(w)w.classList.remove('open');expanded.classList.remove('expanded');setTimeout(function(){if(next.parentNode)next.parentNode.removeChild(next)},350)}
        S.selectedRun=null;
      }
      return;
    }
    return;
  }
  if(e.key==='?'){$('#kbModal').classList.toggle('open');return}
  var viewMap={'1':'watch','2':'tests','3':'runs','4':'live'};
  if(viewMap[e.key]){showView(viewMap[e.key]);return}
  if(e.key==='r'){
    if(S.view==='watch')refreshWatch();
    else if(S.view==='tests'){refreshSuites();refreshVariables()}
    else if(S.view==='runs'){refreshRuns();refreshScreenshots();refreshLearnings()}
    else if(S.view==='live')renderLive();
    return;
  }
  if(S.view==='runs'&&(e.key==='j'||e.key==='k')){
    var visible=_allRunRows.filter(function(item){return item.tr.style.display!=='none'});
    if(!visible.length)return;
    if(e.key==='j')S.highlightedRunIdx=Math.min(S.highlightedRunIdx+1,visible.length-1);
    if(e.key==='k')S.highlightedRunIdx=Math.max(S.highlightedRunIdx-1,0);
    visible.forEach(function(item,i){if(i===S.highlightedRunIdx){item.tr.classList.add('selected');item.tr.scrollIntoView({block:'nearest'})}else item.tr.classList.remove('selected')});
    return;
  }
  if(S.view==='runs'&&e.key==='Enter'){
    var visible2=_allRunRows.filter(function(item){return item.tr.style.display!=='none'});
    if(S.highlightedRunIdx>=0&&S.highlightedRunIdx<visible2.length){visible2[S.highlightedRunIdx].tr.click()}
    return;
  }
});
$('#kbModal').addEventListener('click',function(e){if(e.target===$('#kbModal'))$('#kbModal').classList.remove('open')});
