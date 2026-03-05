/* ── Toast Notifications ── */
function showToast(message,type,timeout){
  type=type||'info';
  timeout=timeout||5000;
  var container=$('#toastContainer');
  var icons={success:'\u2714',error:'\u2718',info:'\u2139'};
  var t=el('div',{className:'toast '+type},[
    el('span',null,icons[type]||''),
    el('span',null,message)
  ]);
  container.appendChild(t);
  setTimeout(function(){
    t.classList.add('fade-out');
    setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t)},300);
  },timeout);
}

function showEnrichedToast(message,type){
  var container=$('#toastContainer');
  var icons={success:'\u2714',error:'\u2718',info:'\u2139'};
  var t=el('div',{className:'toast clickable '+type,onclick:function(){showView('runs');var lb=$('#runsTabLearnings');if(lb)lb.click()}},[
    el('span',null,icons[type]||''),
    el('span',null,message)
  ]);
  container.appendChild(t);
  setTimeout(function(){
    t.classList.add('fade-out');
    setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t)},300);
  },7000);
}

/* ── Download helper ── */
function downloadFile(filename,content,mimeType){
  var blob=new Blob([content],{type:mimeType||'text/plain'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
