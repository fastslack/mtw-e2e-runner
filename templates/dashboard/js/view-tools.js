/* ══════════════════════════════════════════════════════════════════
   Tools View — Module Analysis, Capture, Analyze, Verify, Agent prompts
   ══════════════════════════════════════════════════════════════════ */

/* ── Module Analysis ─────────────────────────────────────────── */
var MA_LAST = null;

function refreshModuleAnalysis(){
  var body=$('#modAnalysisBody');var btnCopy=$('#btnCopyModulePrompt');
  if(!body)return;
  if(!S.project){
    body.innerHTML='';
    body.appendChild(el('div',{className:'tool-empty'},'Pick a project from the sidebar, then click Run analysis.'));
    if(btnCopy)btnCopy.disabled=true;
    return;
  }
  body.innerHTML='';
  body.appendChild(el('div',{className:'tool-empty'},'Running analysis…'));
  api('/api/tools/module-analysis/'+S.project).then(function(data){
    if(data&&data.error){
      body.innerHTML='';
      body.appendChild(el('div',{className:'tool-result is-error'},'Error: '+data.error));
      if(btnCopy)btnCopy.disabled=true;
      return;
    }
    MA_LAST=data;
    if(btnCopy)btnCopy.disabled=!data.agentPrompt;
    renderModuleAnalysis(body,data);
  }).catch(function(e){
    body.innerHTML='';
    body.appendChild(el('div',{className:'tool-result is-error'},'Request failed: '+(e&&e.message||'unknown')));
  });
}

function renderModuleAnalysis(body,data){
  body.innerHTML='';
  var s=data.summary||{};
  var summary=el('div',{className:'mod-summary'},[
    summaryCell('Tests',s.testCount),
    summaryCell('Modules',s.moduleCount),
    summaryCell('Candidates',s.candidateCount,'signal'),
    summaryCell('Unused',s.unusedModules,s.unusedModules>0?'warn':''),
  ]);
  body.appendChild(summary);

  // Extraction candidates
  if(data.candidates&&data.candidates.length){
    body.appendChild(el('div',{className:'mod-section-title'},[
      document.createTextNode('Extraction candidates'),
      el('span',{className:'count'},String(data.candidates.length))
    ]));
    data.candidates.forEach(function(c){
      body.appendChild(renderCandidateRow(c));
    });
  }else{
    body.appendChild(el('div',{className:'mod-section-title'},[
      document.createTextNode('Extraction candidates'),
      el('span',{className:'count'},'0')
    ]));
    body.appendChild(el('div',{className:'tool-empty'},'No duplicated 3-8-action sequences found across tests. Your suite is well factored — or maybe under-modularized?'));
  }

  // Existing modules
  if(data.modules&&data.modules.length){
    body.appendChild(el('div',{className:'mod-section-title'},[
      document.createTextNode('Existing modules'),
      el('span',{className:'count'},String(data.modules.length))
    ]));
    var sorted=data.modules.slice().sort(function(a,b){return (b.usageCount||0)-(a.usageCount||0)});
    sorted.forEach(function(m){body.appendChild(renderModuleRow(m))});
  }
}

function summaryCell(label,value,cls){
  return el('div',{className:'mod-summary-cell'+(cls?' '+cls:'')},[
    el('div',{className:'mod-summary-cell-lbl'},label),
    el('div',{className:'mod-summary-cell-val'},String(value!=null?value:'—'))
  ]);
}

function renderModuleRow(m){
  var cls='mod-row'+(m.usageCount===0?' unused':'');
  var metaItems=[
    el('span',null,(m.actionCount||0)+' actions'),
    el('span',null,(m.params&&m.params.length||0)+' params'),
  ];
  if(m.usedBy&&m.usedBy.length)metaItems.push(el('span',null,'used by: '+m.usedBy.slice(0,3).join(', ')+(m.usedBy.length>3?' +'+(m.usedBy.length-3):'')));
  return el('div',{className:cls},[
    el('div',{className:'mod-row-main'},[
      el('div',{className:'mod-row-name'},m.name),
      m.description?el('div',{className:'mod-row-desc'},m.description):null,
      el('div',{className:'mod-row-meta'},metaItems)
    ]),
    el('div',{className:'mod-row-usage'},(m.usageCount||0)+'×')
  ]);
}

function renderCandidateRow(c){
  var preview=(c.sample||[]).map(function(a,i){
    var bits=[String(i+1).padStart(2,'0')+'.',a.type||'?'];
    if(a.selector)bits.push('@'+a.selector);
    if(a.text!=null)bits.push('"'+String(a.text).slice(0,40)+'"');
    if(a.value!=null&&!a.text)bits.push('= '+String(a.value).slice(0,40));
    return bits.join(' ');
  }).join('\n');
  var usedBy=(c.usedBy||[]).map(function(u){return u.suite+' › '+u.test+(u.occurrences>1?' (×'+u.occurrences+')':'')}).join(', ');
  return el('div',{className:'cand-row'},[
    el('div',{className:'cand-row-head'},[
      el('div',{className:'cand-name'},'Suggested: '+(c.suggestedName||'module')),
      el('div',{className:'cand-stats'},[
        document.createTextNode((c.length||0)+' actions · '),
        el('strong',null,(c.testCount||0)+' tests'),
        document.createTextNode(' · '),
        el('strong',null,(c.occurrenceCount||0)+' occurrences')
      ])
    ]),
    el('div',{className:'cand-actions-preview'},preview),
    el('div',{className:'cand-used-by'},[el('strong',null,'used by: '),document.createTextNode(usedBy)])
  ]);
}

/* ── Capture URL ─────────────────────────────────────────── */
function runCapture(){
  var url=$('#captureUrl').value.trim();var out=$('#captureResult');
  if(!url){out.textContent='URL required';out.classList.add('is-error');return}
  out.classList.remove('is-error');out.textContent='Capturing…';
  var body={url:url,fullPage:$('#captureFullPage').checked};
  if(S.project)body.projectId=S.project;
  fetch('/api/tool/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.error){out.classList.add('is-error');out.textContent='Error: '+d.error;return}
      out.textContent='';
      if(d.hash)out.appendChild(el('div',null,'Hash: '+d.hash));
      if(d.path){
        var img=document.createElement('img');img.src='/api/image?path='+encodeURIComponent(d.path);img.alt='capture';
        out.appendChild(img);
      }
    })
    .catch(function(e){out.classList.add('is-error');out.textContent='Request failed: '+(e&&e.message||'unknown')});
}

/* ── Analyze Page ────────────────────────────────────────── */
function runAnalyze(){
  var url=$('#analyzeUrl').value.trim();var out=$('#analyzeResult');
  if(!url){out.textContent='URL required';out.classList.add('is-error');return}
  out.classList.remove('is-error');out.textContent='Analyzing…';
  var body={url:url};if(S.project)body.projectId=S.project;
  fetch('/api/tool/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.error){out.classList.add('is-error');out.textContent='Error: '+d.error;return}
      out.textContent='';
      var pre=el('pre',null,JSON.stringify(d,null,2));
      out.appendChild(pre);
    })
    .catch(function(e){out.classList.add('is-error');out.textContent='Request failed: '+(e&&e.message||'unknown')});
}

/* ── Verify Issue ────────────────────────────────────────── */
function copyIssuePrompt(){
  var url=$('#issueUrl').value.trim();
  if(!url){showToast&&showToast('Issue URL required','warn');return}
  var prompt='Use the e2e-runner test-creator agent to verify this issue end-to-end:\n\n'+
             '1. Call e2e_issue with url="'+url+'" to fetch the issue details and the suggested test prompt.\n'+
             '2. Generate the test JSON based on the issue requirements.\n'+
             '3. Save it via e2e_create_test.\n'+
             '4. Run it via e2e_run and report pass/fail with screenshots.';
  copyToClipboard(prompt);
}
function runIssueVerify(){
  var url=$('#issueUrl').value.trim();var out=$('#issueResult');
  if(!url){out.textContent='URL required';out.classList.add('is-error');return}
  out.classList.remove('is-error');out.textContent='Calling Anthropic API... this can take a minute.';
  fetch('/api/tool/issue-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url,projectId:S.project||null})})
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.error){out.classList.add('is-error');out.textContent='Error: '+d.error;return}
      out.textContent='';
      out.appendChild(el('pre',null,JSON.stringify(d,null,2)));
    })
    .catch(function(e){out.classList.add('is-error');out.textContent='Request failed: '+(e&&e.message||'unknown')});
}

/* ── Agent prompt copy buttons ───────────────────────────── */
var AGENT_PROMPTS={
  improver:'Run the test-improver agent on this project. Tasks:\n'+
    '1. Use e2e_list to enumerate suites + modules.\n'+
    '2. Identify duplicated 3+ action sequences across tests (canonical $use candidates).\n'+
    '3. For each candidate, call e2e_create_module with sensible parameters, then Edit the test files to replace the inline sequence with {"$use":"<module-name>","params":{...}}.\n'+
    '4. Replace any verbose evaluate blocks with built-in actions where possible.\n'+
    '5. Run the affected suites via e2e_run and confirm no regressions.\n'+
    '6. Report a summary: modules created, sequences replaced, tests touched.',
  creator:'Run the test-creator agent on this project. Tasks:\n'+
    '1. Ask me which feature/page you should write a new test for.\n'+
    '2. Use e2e_analyze on the target URL to map interactive elements.\n'+
    '3. Design a clear action sequence (goto, asserts, click, type, etc.).\n'+
    '4. Save via e2e_create_test and run it via e2e_run.\n'+
    '5. If it passes, show me the JSON + screenshot. If it fails, debug and fix.',
  analyzer:'Run the test-analyzer agent on this project. Tasks:\n'+
    '1. Use e2e_learnings query="summary" to get the current stability state.\n'+
    '2. Use e2e_learnings query="flaky" and "errors" to drill into problems.\n'+
    '3. For each top issue, check e2e_network_logs for the relevant runDbIds.\n'+
    '4. Recommend concrete fixes: stabilization (waits, retries), selector hardening, or root-cause investigations.',
};
function copyAgentPrompt(name){
  var p=AGENT_PROMPTS[name];if(!p)return;
  copyToClipboard(p);
}

function copyToClipboard(text){
  try{
    if(navigator.clipboard){navigator.clipboard.writeText(text).then(function(){showToast&&showToast('Copied to clipboard','success')});return}
  }catch(e){}
  var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
  document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');showToast&&showToast('Copied to clipboard','success')}catch(e){showToast&&showToast('Could not copy','error')}
  document.body.removeChild(ta);
}

/* ── Wire up buttons ─────────────────────────────────────── */
(function(){
  var b1=$('#btnRunModuleAnalysis');if(b1)b1.addEventListener('click',refreshModuleAnalysis);
  var b2=$('#btnCopyModulePrompt');if(b2)b2.addEventListener('click',function(){
    if(MA_LAST&&MA_LAST.agentPrompt)copyToClipboard(MA_LAST.agentPrompt);
  });
  var c1=$('#btnRunCapture');if(c1)c1.addEventListener('click',runCapture);
  var a1=$('#btnRunAnalyze');if(a1)a1.addEventListener('click',runAnalyze);
  var i1=$('#btnIssuePrompt');if(i1)i1.addEventListener('click',copyIssuePrompt);
  var i2=$('#btnIssueVerify');if(i2)i2.addEventListener('click',runIssueVerify);
  document.querySelectorAll('[data-prompt]').forEach(function(btn){
    btn.addEventListener('click',function(){copyAgentPrompt(btn.dataset.prompt)});
  });
})();
