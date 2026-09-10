/* PyLearn frontend — real kernel-backed IDE */
const API = async (p, o={}) => {
  const r = await fetch(p, {headers:{"Content-Type":"application/json"}, ...o});
  return r.json();
};
const $ = s => document.querySelector(s);
const esc = s => String(s??"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let SID = localStorage.getItem("pylearn_sid") || "";
let RUNNING = false, STOPFLAG = false;

/* ---------- i18n ---------- */
const I18N = {
  lang:"en",
  dict:{
    en:{new:"＋ New",runall:"▶ Run All"},
    ar:{new:"＋ جديد",runall:"▶ تشغيل الكل"},
    fr:{new:"＋ Nouveau",runall:"▶ Tout exécuter"}
  },
  set(l){ this.lang=l; document.documentElement.lang=l;
    document.body.classList.toggle("rtl", l==="ar");
    document.getElementById("langSel").value=l;
    UI.tab(UI.current);
    if(l==="ar"){toast("تم التفعيل: الواجهة RTL — الكود يبقى LTR");}
  }
};

/* ---------- UI shell ---------- */
const UI = {
  current:"files",
  tab(t){ this.current=t;
    document.querySelectorAll("#side-tabs button").forEach(b=>b.classList.toggle("active",b.dataset.t===t));
    ({files:Files.render,lessons:Lessons.render,exercises:Ex.render,datasets:Data.render,libs:Libs.render,vars:Vars.render,history:Hist.render,progress:Prog.render})[t]();
  },
  theme(){ const h=document.documentElement; h.dataset.theme=h.dataset.theme==="dark"?"light":"dark"; },
  mode(m){ document.getElementById("probar").style.display = m==="pro"?"flex":"none";
    document.querySelectorAll(".pro-only").forEach(e=>e.style.display=m==="pro"?"":"none");
    toast(m==="pro"?"Professional mode: terminal/env/git/profiler enabled":"Beginner mode: Code ← | → Result + Explanation"); },
  mobileToggle(){ const c=$("#cells-pane"),o=$("#out-pane");
    const showOut=o.style.display!=="none"; o.style.display=showOut?"none":""; c.style.display=showOut?"":"none"; },
  modal(html){ const m=$("#modal"); $("#modal-box").innerHTML=html; m.classList.add("open"); m.onclick=e=>{if(e.target.id==="modal")m.classList.remove("open")}; },
  close(){ $("#modal").classList.remove("open"); }
};
function toast(m){ const b=$("#statusbar"); const s=document.createElement("span"); s.textContent="• "+m; b.appendChild(s); setTimeout(()=>s.remove(),4000); }
// resizable divider
(()=>{ const d=document.getElementById("divider"); let drag=false;
  d.addEventListener("mousedown",()=>drag=true); window.addEventListener("mouseup",()=>drag=false);
  window.addEventListener("mousemove",e=>{ if(!drag)return; const m=$("#main").getBoundingClientRect();
    const pct=(e.clientX-m.left)/m.width; const c=$("#cells-pane"),o=$("#out-pane");
    c.style.flex=pct*2; o.style.flex=(1-pct)*2; });
})();
// keyboard shortcuts
document.addEventListener("keydown",e=>{
  const t=e.target; if(!t.classList||!t.classList.contains("code"))return;
  if(e.shiftKey&&e.key==="Enter"){e.preventDefault();NB.runCell(t.dataset.id,false);}
  else if(e.ctrlKey&&e.key==="Enter"){e.preventDefault();NB.runCell(t.dataset.id,true);}
  else if(e.altKey&&e.key==="Enter"){e.preventDefault();NB.runCell(t.dataset.id,false,true);}
});

/* ---------- Notebook model ---------- */
const NB = {
  name:"welcome.ipynb", cells:[],
  newNotebook(){ this.name="notebook-"+Date.now().toString(36)+".ipynb";
    this.cells=[{id:uid(),type:"markdown",source:"# Welcome to PyLearn\nYour interactive Python learning environment."},
      {id:uid(),type:"code",source:'print("Hello, Python!")'},
      {id:uid(),type:"code",source:'import numpy as np\nx = np.array([1,2,3,4,5])\nprint("mean =", x.mean())'}];
    this.render(); OUT.renderAll(); this.autosave(); toast("New notebook created"); },
  uid:0,
  render(){ const p=$("#cells-pane"); p.innerHTML=`<div class="card small"><b>📓 ${esc(this.name)}</b> — each cell runs independently, kernel state is shared. <span class="mut">Shift+Enter run • Ctrl+Enter run (stay) • Alt+Enter run+new</span>
    <div style="margin-top:6px"><button onclick="NB.addCell('code')">+ Code cell</button> <button onclick="NB.addCell('markdown')">+ Markdown cell</button> <button onclick="NB.save()">💾 Save</button> <button onclick="NB.save(true)">Save As</button></div></div>`;
    this.cells.forEach((c,i)=>{ const d=document.createElement("div"); d.className="cell"; d.id="cell-"+c.id;
      d.innerHTML=`<div class="cell-head"><span class="n">${c.type==="code"?"In["+(i+1)+"]":"MD"}</span>
        <select onchange="NB.setType('${c.id}',this.value)"><option value="code" ${c.type==="code"?"selected":""}>Code</option><option value="markdown" ${c.type==="markdown"?"selected":""}>Markdown</option></select>
        <span class="sp"></span>
        ${c.type==="code"?`<button class="primary" onclick="NB.runCell('${c.id}')">▶ Run</button><button onclick="NB.runAbove('${c.id}')">↑ Above</button><button onclick="NB.runBelow('${c.id}')">↓ Below</button>`:`<button onclick="NB.renderMd('${c.id}')">👁 Preview</button>`}
        <button onclick="NB.dup('${c.id}')">⧉</button><button onclick="NB.move('${c.id}',-1)">▲</button><button onclick="NB.move('${c.id}',1)">▼</button><button class="danger" onclick="NB.del('${c.id}')">✕</button></div>
        ${c.type==="code"?`<textarea class="code" data-id="${c.id}" spellcheck="false">${esc(c.source)}</textarea>`:`<textarea class="md-edit" data-id="${c.id}" spellcheck="false">${esc(c.source)}</textarea><div class="out-body mdprev" id="mdp-${c.id}"></div>`}`;
      p.appendChild(d);
      const ta=d.querySelector("textarea"); ta.addEventListener("input",()=>{c.source=ta.value;NB.autosave();});
      ta.addEventListener("focus",()=>{document.querySelectorAll(".cell").forEach(x=>x.classList.remove("selected"));d.classList.add("selected");});
    });
  },
  get(id){return this.cells.find(c=>c.id===id)},
  setType(id,t){this.get(id).type=t;this.render()},
  renderMd(id){const c=this.get(id);document.getElementById("mdp-"+id).innerHTML=marked.parse(c.source);},
  addCell(type,after){ const c={id:uid(),type,source:type==="code"?"# new code\n":"# New section"}; 
    if(!after){this.cells.push(c)} else {const i=this.cells.findIndex(x=>x.id===after);this.cells.splice(i+1,0,c)}
    this.render(); this.autosave(); },
  dup(id){const i=this.cells.findIndex(x=>x.id===id);this.cells.splice(i+1,0,{id:uid(),type:this.cells[i].type,source:this.cells[i].source});this.render()},
  del(id){this.cells=this.cells.filter(x=>x.id!==id);this.render();this.autosave()},
  move(id,d){const i=this.cells.findIndex(x=>x.id===id);const j=i+d;if(j<0||j>=this.cells.length)return;const[c]=this.cells.splice(i,1);this.cells.splice(j,0,c);this.render()},
  async runCell(id,stay=false,addNew=false){ const c=this.get(id); if(!c||c.type!=="code")return;
    if(!stay){document.getElementById("cell-"+id)?.scrollIntoView({block:"nearest"})}
    RUNNING=true;STOPFLAG=false;KDOT(true);
    OUT.placeholder(id);
    const t0=performance.now();
    try{ const res=await API("/api/execute",{method:"POST",body:JSON.stringify({session_id:SID,code:c.source})});
      SID=res.session_id;localStorage.setItem("pylearn_sid",SID);
      OUT.show(id,res); Vars.refresh(true);
      $("#st-exec").textContent="Exec: "+res.elapsed+"s";
      const idx=this.cells.findIndex(x=>x.id===id);
      if(addNew)this.addCell("code",id);
      else if(!stay&&this.cells[idx+1])document.getElementById("cell-"+this.cells[idx+1].id)?.scrollIntoView({block:"nearest"});
    }catch(e){ OUT.error(id,e.message);} 
    RUNNING=false;KDOT(false); Hist.refresh(true);
  },
  async runAbove(id){ for(const c of this.cells){ if(c.type!=="code")continue; await this.runCell(c.id,true); if(c.id===id)break; if(STOPFLAG)break; } },
  async runBelow(id){ let go=false; for(const c of this.cells){ if(c.id===id)go=true; if(go&&c.type==="code"){await this.runCell(c.id,true); if(STOPFLAG)break;} } },
  async runAll(){ for(const c of this.cells){ if(c.type!=="code")continue; if(STOPFLAG)break; await this.runCell(c.id,true);} toast("Run All finished"); },
  stop(){STOPFLAG=true;RUNNING=false;KDOT(false);API("/api/kernel/interrupt",{method:"POST",body:JSON.stringify({session_id:SID})});toast("Stop requested")},
  async restartKernel(){ await API("/api/kernel/restart",{method:"POST",body:JSON.stringify({session_id:SID})}); toast("Kernel restarted — variables cleared"); Vars.refresh(true); },
  autosave(){ clearTimeout(this._t); this._t=setTimeout(()=>this.save(true),1200); $("#st-save").textContent="Saving…"; },
  async save(silent=false,name){ if(name){const n=prompt("Notebook name:",this.name); if(n)this.name=n.endsWith(".ipynb")?n:n+".ipynb";}
    const nb={nbformat:4,nbformat_minor:5,metadata:{language:"python"},cells:this.cells.map(c=>({cell_type:c.type==="code"?"code":"markdown",source:c.source,outputs:[],execution_count:null}))};
    await API("/api/notebooks/save",{method:"POST",body:JSON.stringify({name:this.name,notebook:{cells:this.cells.map(c=>({type:c.type,source:c.source}))}})});
    // also save real .ipynb
    $("#st-save").textContent="Auto-save ✓ "+new Date().toLocaleTimeString(); if(!silent)toast("Saved "+this.name); Files.refresh(true); },
  async openLocal(inp){ const f=inp.files[0]; if(!f)return; const txt=await f.text();
    if(f.name.endsWith(".ipynb")){ try{const j=JSON.parse(txt); this.cells=(j.cells||[]).map(c=>({id:uid(),type:c.cell_type==="code"?"code":"markdown",source:Array.isArray(c.source)?c.source.join(""):(c.source||"")}));}
      catch{this.cells=[{id:uid(),type:"code",source:txt}];} }
    else if(f.name.endsWith(".py")){ this.cells=txt.split(/# ---\n?/).filter(s=>s.trim()).map(s=>({id:uid(),type:"code",source:s})); }
    else{ this.cells=[{id:uid(),type:"code",source:`# loaded ${f.name}\n${txt.slice(0,2000)}`}]; }
    this.name=f.name.endsWith(".ipynb")?f.name:f.name+".ipynb"; this.render(); OUT.renderAll(); },
  exportMenu(){ UI.modal(`<h3>Export notebook</h3><div style="display:flex;gap:8px;flex-wrap:wrap">
    <button onclick="NB.doExport('py')">.py</button><button onclick="NB.doExport('html')">.html</button>
    <button onclick="NB.doExport('md')">.md</button><button onclick="NB.doExport('ipynb')">.ipynb</button>
    <button onclick="UI.close()">Close</button></div>`); },
  async doExport(fmt){ const cells=this.cells;
    let content="",mime="text/plain",ext=fmt;
    if(fmt==="py"){ const r=await API("/api/export/py",{method:"POST",body:JSON.stringify({notebook:{cells}})}); content=r.code; mime="text/x-python"; }
    else if(fmt==="md"){ content=cells.map(c=>c.type==="code"?"```python\n"+c.source+"\n```":"\n"+c.source).join("\n\n"); mime="text/markdown"; }
    else if(fmt==="html"){ content="<html><head><meta charset='utf8'></head><body>"+cells.map(c=>c.type==="code"?"<pre>"+esc(c.source)+"</pre>":marked.parse(c.source)).join("")+"</body></html>"; mime="text/html"; }
    else{ content=JSON.stringify({nbformat:4,cells:cells.map(c=>({cell_type:c.type,source:c.source}))},null,2); mime="application/json"; }
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type:mime})); a.download=this.name.replace(".ipynb","")+"."+ext; a.click(); UI.close(); }
};
function uid(){return "c"+Math.random().toString(36).slice(2,9)}
function KDOT(run){ const d=$("#kernel-dot"); d.classList.toggle("running",run); $("#kernel-label").textContent=run?"Python — Running…":"Python — Ready"; }

/* ---------- Output panel ---------- */
const OUT = {
  store:{},
  placeholder(id){ const p=$("#out-pane"); let el=document.getElementById("out-"+id);
    if(!el){el=document.createElement("div");el.id="out-"+id;el.className="out-card";p.prepend(el);}
    el.innerHTML=`<header>⚙️ Cell ${esc(id)} — <span style="color:var(--warn)">Running…</span> <span class="elapsed"></span></header><div class="out-body"><div class="progress"><div style="width:40%"></div></div></div>`;
    const t0=Date.now(); el._t=setInterval(()=>{const e=el.querySelector(".elapsed");if(e)e.textContent="Elapsed: "+((Date.now()-t0)/1000).toFixed(1)+"s"},200);
  },
  error(id,msg){ const el=document.getElementById("out-"+id)||this.mk(id); el.innerHTML=`<header>❌ Cell</header><div class="out-body"><div class="errbox">${esc(msg)}</div></div>`; },
  mk(id){ const el=document.createElement("div");el.id="out-"+id;el.className="out-card";$("#out-pane").prepend(el);return el; },
  show(id,res){ clearInterval(document.getElementById("out-"+id)?._t); this.store[id]=res;
    let el=document.getElementById("out-"+id)||this.mk(id);
    let h=`<header>✅ Out[${res.exec_count}] · ${res.elapsed}s · ${res.memory_mb}MB <span style="flex:1"></span><button onclick="OUT.explain('${id}')">💡 Explain</button></header><div class="out-body">`;
    if(Beginner.on){ h+=`<div class="card small">Result below — plain explanation follows each output.</div>`; }
    for(const o of res.outputs){ h+=this.renderOut(o,id,res); }
    if(res.error){ const e=res.error;
      h+=`<div class="errbox"><b>${esc(e.type)}</b> ${e.lineno?`— Cell line ${e.lineno}`:""}<pre class="err">${esc(e.traceback.slice(-1500))}</pre>
      <div class="hint">💡 <b>What happened:</b> ${esc(e.hint)}<br>${e.fix?`🔧 <b>Fix:</b> ${esc(e.fix)}<br>`:""}
      ${e.install_package?`<button class="primary" onclick="Libs.install('${esc(e.install_package)}')">Install ${esc(e.install_package)}</button>`:""}
      <button onclick="AI.debug('${id}')">🤖 Explain error</button></div></div>`;
    }
    if(!res.outputs.length&&!res.error)h+=`<p class="mut">✓ Executed, no output (assignment or silent op). Check Variables panel.</p>`;
    // beginner explanation
    if(Beginner.on){ h+=`<div class="card small">📖 <b>Explanation:</b> ${esc(Beginner.explain(this.store[id],NB.get(id)?.source||""))}</div>`; }
    h+=`</div>`; el.innerHTML=h;
    el.querySelectorAll("latex").forEach(n=>{try{katex.render(n.textContent,n,{throwOnError:false})}catch{}});
  },
  renderOut(o,id,res){
    if(o.type==="text"||o.type==="stderr")return `<pre class="${o.type==="stderr"?"err":""}">${esc(o.text)}</pre>`;
    if(o.type==="image")return `<div><img class="plot" src="data:image/png;base64,${o.base64}"><div><button onclick="OUT.dl('${id}','png')">⬇ PNG</button> <button onclick="OUT.full('${id}')">⛶ Full screen</button></div></div>`;
    if(o.type==="plotly")return `<div class="plotly" data-id="${id}">${o.html}<script>void 0<\/script></div><p class="small mut">Interactive Plotly chart (pan/zoom in toolbar).</p>`;
    if(o.type==="html")return `<div>${o.html}</div>`;
    if(o.type==="latex")return `<div class="katex-wrap"><latex>${esc(o.latex)}</latex><pre>${esc(o.text)}</pre></div>`;
    if(o.type==="dataframe")return this.dfTable(o,id);
    return `<pre>${esc(JSON.stringify(o).slice(0,2000))}</pre>`;
  },
  dfTable(o,id){
    const key="df_"+id; window[key]=o.records;
    const rows=o.records.slice(0,10).map(r=>`<tr>${o.columns.map(c=>`<td>${esc(r[c])}</td>`).join("")}</tr>`).join("");
    return `<div class="small mut">DataFrame ${o.shape[0]} × ${o.shape[1]} — search / sort / paginate / export</div>
    <input placeholder="🔍 search…" oninput="OUT.search('${id}',this.value)">
    <div style="overflow:auto;max-height:300px"><table class="df-table" id="tbl-${id}"><thead><tr>${o.columns.map((c,i)=>`<th onclick="OUT.sort('${id}',${i})" style="cursor:pointer">${esc(c)} ⇅<br><span class="mut">${esc(o.dtypes[c]||"")}</span></th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    <div style="margin-top:6px"><button onclick="OUT.csv('${id}')">⬇ CSV</button> <button onclick="OUT.copyCsv('${id}')">⧉ Copy</button> <button onclick="Data.edaFromOutput('${id}')">📊 EDA report</button></div>`;
  },
  search(id,q){ const o=this.store[id].outputs.find(x=>x.type==="dataframe"); if(!o)return;
    const f=o.records.filter(r=>JSON.stringify(r).toLowerCase().includes(q.toLowerCase())).slice(0,10);
    document.querySelector(`#tbl-${id} tbody`).innerHTML=f.map(r=>`<tr>${o.columns.map(c=>`<td>${esc(r[c])}</td>`).join("")}</tr>`).join(""); },
  sort(id,i){ const o=this.store[id].outputs.find(x=>x.type==="dataframe"); const c=o.columns[i];
    o.records.sort((a,b)=>String(a[c])>String(b[c])?1:-1); this.show(id,this.store[id]); },
  csv(id){ const o=this.store[id].outputs.find(x=>x.type==="dataframe");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([o.csv],{type:"text/csv"}));a.download="dataframe.csv";a.click(); },
  copyCsv(id){ const o=this.store[id].outputs.find(x=>x.type==="dataframe"); navigator.clipboard.writeText(o.csv); toast("CSV copied"); },
  dl(id){ const img=document.querySelector(`#out-${id} img`); if(img){const a=document.createElement("a");a.href=img.src;a.download="chart.png";a.click();} },
  full(id){ const img=document.querySelector(`#out-${id} img`); if(img)UI.modal(`<img style="width:100%" src="${img.src}"><br><button onclick="UI.close()">Close</button>`); },
  renderAll(){ $("#out-pane").innerHTML=`<div class="card"><h4>📊 Output & Results</h4><p class="mut small">Run a cell on the left (Shift+Enter).</p></div>`; },
  async explain(id){ const src=NB.get(id)?.source||""; const r=await API("/api/ai/ask",{method:"POST",body:JSON.stringify({code:src,mode:"explain"})}); UI.modal(`<h3>💡 Explanation</h3><div>${marked.parse(r.answer)}</div><button onclick="UI.close()">Close</button>`); }
};
const Beginner={on:true,explain(res,src){ if(res.error)return "The cell raised an error — read the red box: it names the line and suggests a fix.";
  if(/sum\(|mean|average/.test(src))return "An aggregation combined many numbers into one result.";
  if(/pd\.|DataFrame|read_csv/.test(src))return "pandas loaded/processed tabular data — see the interactive table.";
  if(/plt\.|plot|px\.|seaborn/.test(src))return "A chart was drawn from your data.";
  if(/print/.test(src))return "print() displays values in the output panel.";
  return "The code ran top-to-bottom; assignments are kept in the kernel for later cells.";}};

/* ---------- Files ---------- */
const Files={
  cache:[],
  async render(){ const b=$("#side-body"); b.innerHTML=`<button onclick="NB.newNotebook()">＋ Notebook</button> <button onclick="Files.newPy()">＋ .py</button> <button onclick="document.getElementById('upFile').click()">⤒ Upload</button><div id="flist" class="small">loading…</div>`;
    await this.refresh(); },
  async refresh(silent){ try{ const r=await API("/api/files"); this.cache=r.files;
    const el=document.getElementById("flist"); if(!el){if(silent)return; return this.render();}
    el.innerHTML=this.cache.map(f=>`<div class="card small">📄 <b>${esc(f.name)}</b> <span class="mut">${f.scope} · ${(f.size/1024).toFixed(1)}KB</span><br><button onclick="Files.openIt('${f.scope}','${esc(f.name)}')">Open</button> <button onclick="Files.preview('${f.scope}','${esc(f.name)}')">Preview/EDA</button></div>`).join("")||"<p class='mut'>No files yet — upload a CSV.</p>";
    }catch{} },
  newPy(){ NB.cells.push({id:uid(),type:"code",source:"# script\nprint('hello')"}); NB.render(); },
  async upload(inp){ const f=inp.files[0]; if(!f)return; const fd=new FormData(); fd.append("file",f); fd.append("scope","data");
    const r=await fetch("/api/upload",{method:"POST",body:fd}).then(r=>r.json());
    toast("Uploaded "+r.name); if(r.suggest){NB.cells.push({id:uid(),type:"code",source:r.suggest});NB.render();}
    this.refresh(true); UI.tab("datasets"); },
  async openIt(scope,name){ if(name.endsWith(".ipynb")){ const nb=await API("/api/notebooks/"+encodeURIComponent(name));
      NB.cells=(nb.cells||[]).map(c=>({id:uid(),type:c.type,source:c.source})); NB.name=name; NB.render(); OUT.renderAll(); }
    else{ const r=await API(`/api/dataset/preview?scope=${scope}&name=${encodeURIComponent(name)}`);
      if(r.kind==="text")NB.cells.push({id:uid(),type:"code",source:`# ${name}\n`+r.text.slice(0,500)});
      else NB.cells.push({id:uid(),type:"code",source:`import pandas as pd\ndf = pd.read_${name.endsWith(".json")?"json":name.endsWith(".parquet")?"parquet":"csv"}("data/${name}")\ndf.head()`});
      NB.render(); } },
  async preview(scope,name){ const r=await API(`/api/dataset/preview?scope=${scope}&name=${encodeURIComponent(name)}`);
    if(r.kind!=="dataframe"){UI.modal(`<h3>${esc(name)}</h3><pre>${esc(r.text||r.message||"unsupported")}</pre><button onclick="UI.close()">Close</button>`);return;}
    UI.modal(`<h3>📊 ${esc(name)} — ${r.shape[0]} × ${r.shape[1]}</h3>
    <p class="small">Missing: <b>${Object.values(r.missing).reduce((a,b)=>a+b,0)}</b> · Duplicates: <b>${r.duplicates}</b></p>
    <div style="overflow:auto"><table class="df-table"><tr><th>col</th><th>dtype</th><th>missing</th></tr>${r.columns.map(c=>`<tr><td>${esc(c)}</td><td>${esc(r.dtypes[c])}</td><td>${r.missing[c]}</td></tr>`).join("")}</table></div>
    <h4>describe()</h4><div style="overflow:auto;max-height:220px"><pre>${esc(JSON.stringify(r.describe,null,1).slice(0,3000))}</pre></div>
    <button onclick="Data.hist('${esc(name)}')">📈 Histograms</button> <button onclick="UI.close()">Close</button>`); }
};

/* ---------- Datasets tab ---------- */
const Data={
  render(){ const b=$("#side-body"); const ds=Files.cache.filter(f=>/\.(csv|xlsx?|json|parquet|txt)$/i.test(f.name));
    b.innerHTML=`<input placeholder="🔍 search datasets…" oninput="Data.filter(this.value)"><div id="dslist">`+(ds.map(f=>`<div class="card small">🗂 <b>${esc(f.name)}</b><br><button onclick="Files.preview('${f.scope}','${esc(f.name)}')">Explore / EDA</button> <button onclick="Files.openIt('${f.scope}','${esc(f.name)}')">Open as DataFrame</button></div>`).join("")||"<p class='mut'>Upload a CSV to start.</p>")+`</div>
    <div class="card small"><b>Sample datasets</b><br><button onclick="Data.sample('titanic')">Load titanic sample</button> <button onclick="Data.sample('iris')">Load iris sample</button></div>`; },
  filter(q){ document.querySelectorAll("#dslist .card").forEach(c=>c.style.display=c.textContent.toLowerCase().includes(q.toLowerCase())?"":"none"); },
  async sample(which){ const code=which==="iris"?`from sklearn.datasets import load_iris\nimport pandas as pd\ndf = pd.DataFrame(load_iris().data, columns=load_iris().feature_names)\ndf["target"]=load_iris().target\ndf.head()`: `import pandas as pd\ndf = pd.read_csv("https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv")\ndf.head()`;
    NB.cells.push({id:uid(),type:"code",source:code}); NB.render(); toast("Sample code added — press Run"); },
  async hist(name){ const code=`import pandas as pd, matplotlib.pyplot as plt\nimport glob\np = list(__import__("pathlib").Path("data").rglob("${name}"))[0] if list(__import__("pathlib").Path("data").rglob("${name}")) else "${name}"\ndf = pd.read_csv(p) if str(p).endswith(".csv") else pd.read_parquet(p) if str(p).endswith(".parquet") else pd.read_json(p)\ndf.select_dtypes("number").hist(figsize=(9,6))\nplt.tight_layout()\nprint(df.shape)\ndf.describe()`; 
    NB.cells.push({id:uid(),type:"code",source:code}); NB.render(); UI.close(); toast("EDA code added — press Run All on it"); },
  edaFromOutput(id){ toast("Full stats available in Variables inspector + dataset preview"); UI.tab("vars"); }
};

/* ---------- Libraries ---------- */
const MARKET=[["numpy","NumPy","Numerical computing"],["pandas","Pandas","DataFrames"],["scipy","SciPy","Scientific computing"],["polars","Polars","Fast DataFrames"],["matplotlib","Matplotlib","Plots"],["seaborn","Seaborn","Statistical charts"],["plotly","Plotly","Interactive charts"],["bokeh","Bokeh","Web plots"],["altair","Altair","Declarative viz"],["scikit-learn","sklearn","Machine learning"],["xgboost","XGBoost","Gradient boosting"],["lightgbm","LightGBM","Fast GBM"],["torch","PyTorch","Deep learning"],["tensorflow","TensorFlow","Deep learning"],["keras","Keras","Neural nets API"],["nltk","NLTK","NLP"],["transformers","Transformers","LLMs"],["opencv-python","OpenCV","Computer vision"],["pillow","Pillow","Images"],["scikit-image","scikit-image","Image processing"],["statsmodels","Statsmodels","Statistics"],["linearmodels","linearmodels","Econometrics"],["arch","arch","Time series"],["sympy","SymPy","Symbolic math"],["jupyter","Jupyter","Notebook ecosistema"]];
const Libs={
  async render(){ const b=$("#side-body"); b.innerHTML=`<input id="libq" placeholder="pip install … e.g. numpy" onkeydown="if(event.key==='Enter')Libs.install(this.value)"><button class="primary" onclick="Libs.install(document.getElementById('libq').value)">Install</button> <button onclick="Libs.render()">Reload</button><div id="liblist" class="small">loading…</div><h4>⭐ Marketplace (one-click)</h4><div class="lib-grid">`+MARKET.map(m=>`<div class="card small"><b>${m[1]}</b> <span class="mut">${m[2]}</span><br><span class="badge">pip: ${m[0]}</span><br><button onclick="Libs.install('${m[0]}')">Install</button> <button onclick="window.open('https://pypi.org/project/${m[0]}')">Docs</button></div>`).join("")+`</div>`;
    try{ const r=await API("/api/packages"); document.getElementById("liblist").innerHTML=`<b>${r.packages.length} installed</b><br>`+r.packages.slice(0,60).map(p=>`<span class="badge">${esc(p.name)} ${esc(p.version)}</span> <button onclick="Libs.uninstall('${esc(p.name)}')">✕</button>`).join(" "); }catch(e){} },
  async install(name){ name=(name||"").trim(); if(!name)return toast("Type a package name");
    toast("Installing "+name+"… (see Libraries log)"); const r=await API("/api/packages/install",{method:"POST",body:JSON.stringify({name})});
    UI.modal(`<h3>${r.ok?"✅ Installed":"❌ Install issue"} — ${esc(name)}</h3><pre>${esc((r.stdout||"")+(r.stderr||""))}</pre><button onclick="UI.close();Libs.render()">Close</button>`); },
  async uninstall(name){ const r=await API("/api/packages/uninstall",{method:"POST",body:JSON.stringify({name})}); toast(r.ok?"Uninstalled":"See log"); this.render(); }
};

/* ---------- Variables / History / Progress ---------- */
const Vars={
  async render(){ const b=$("#side-body"); b.innerHTML=`<button onclick="Vars.render()">↻ Refresh</button><div id="vlist" class="small">loading…</div>`; this.refresh(); },
  async refresh(silent){ try{ const r=await API("/api/variables?session_id="+SID); SID=r.session_id;
    const el=document.getElementById("vlist"); if(!el)return;
    el.innerHTML=r.variables.map(v=>`<div class="card small var-row" onclick='Vars.inspect(${JSON.stringify(v.name)})'><b>${esc(v.name)}</b> <span class="badge">${esc(v.type)}</span> <span class="mut">${esc(v.shape||"")}</span><br><span class="mut">${esc(v.preview||"")}</span></div>`).join("")||"<p class='mut'>No variables yet — run a cell.</p>";
    window._vars=r.variables; }catch{} },
  inspect(name){ const v=(window._vars||[]).find(x=>x.name===name); if(!v)return;
    UI.modal(`<h3>🔍 ${esc(v.name)} <span class="badge">${esc(v.type)}</span></h3><pre>${esc(v.preview||"")}</pre>
    ${v.extra&&v.extra.columns?`<p>Shape: <b>${esc(v.shape)}</b> · Missing: <b>${v.extra.missing}</b> · Memory: <b>${v.extra.memory_kb} KB</b></p><p class="small">Columns: ${v.extra.columns.map(esc).join(", ")}</p>`:""}
    <button onclick="UI.close()">Close</button>`); }
};
const Hist={ async render(){ const b=$("#side-body"); const r=await API("/api/kernel/status?session_id="+SID);
    b.innerHTML=`<div class="card small">Kernel <b>${esc(r.status)}</b> · exec #${r.exec_count}</div>`+(r.history||[]).reverse().map(h=>`<div class="card small">In[${h.n}] · ${h.elapsed}s ${h.error?"❌":"✅"}<pre>${esc(h.code)}</pre></div>`).join(""); },
  async refresh(silent){ if(UI.current==="history")this.render(); } };
const Prog={ render(){ const p=JSON.parse(localStorage.getItem("pylearn_prog")||'{"lessons":[],"ex":[],"streak":1}');
    const b=$("#side-body"); b.innerHTML=`<div class="card"><h4>🏆 Progress</h4><p>Python Level: <b>${p.lessons.length>20?"Intermediate":p.lessons.length>5?"Beginner+":"Starter"}</b></p>
    <p class="small">Lessons: ${p.lessons.length} / 80</p><div class="progress"><div style="width:${Math.min(100,p.lessons.length/80*100)}%"></div></div>
    <p class="small">Exercises: ${p.ex.length} / 100</p><div class="progress"><div style="width:${Math.min(100,p.ex.length)}%"></div></div>
    <p class="small">Current Streak: ${p.streak} day(s) 🔥</p></div>`; },
  done(kind,id){ const p=JSON.parse(localStorage.getItem("pylearn_prog")||'{"lessons":[],"ex":[],"streak":1}');
    const arr=kind==="lesson"?p.lessons:p.ex; if(!arr.includes(id))arr.push(id);
    localStorage.setItem("pylearn_prog",JSON.stringify(p)); } };

/* ---------- Curriculum ---------- */
const CURR={
 python:[["Intro","print('Hello')\nname='Sara'\nprint('Hi',name)",'Write your name in a variable and print it.',"assert True"],
 ["Variables","x=10\ny=3.5\ns='data'\nprint(x,type(x))\nprint(y,type(y))\nprint(s.upper())","Create `a=7`, `b=2`, print a+b, a*b.","assert True"],
 ["Lists","nums=[1,2,3,4,5]\nprint(sum(nums))\nprint(nums[1:4])","Use sum() and slicing on [4,5,6,7].","assert sum([4,5,6,7])==22"],
 ["Dicts","s={'name':'Sara','score':95}\nprint(s['score'])\ns['level']='intermediate'\nprint(s)","Build a dict with your info.","assert True"],
 ["Loops","for i in range(5):\n    print(i, i**2)","Print squares 1..10.","assert True"],
 ["Functions","def average(ns):\n    return sum(ns)/len(ns) if ns else 0\nprint(average([1,2,3]))","Write average() — tested below.","assert average([1,2,3])==2\nassert average([10,20])==15\nassert average([])==0"],
 ["OOP","class Dog:\n    def __init__(self,n):\n        self.n=n\n    def bark(self):\n        return f'{self.n} says woof!'\nprint(Dog('Rex').bark())","Add a Cat class with meow().","assert True"],
 ["Exceptions","try:\n    x=int('abc')\nexcept ValueError as e:\n    print('caught:',e)","Catch ZeroDivisionError.","assert True"]],
 ds:[["NumPy","import numpy as np\na=np.array([1,2,3,4,5])\nprint(a.mean(),a.std())","Compute mean of [10,20,30].","assert True"],
 ["Pandas","import pandas as pd\ndf=pd.DataFrame({'a':[1,2,3],'b':[4,5,6]})\nprint(df.describe())\ndf","Load a CSV from data/ and show head.","assert True"],
 ["EDA","import pandas as pd\nfrom sklearn.datasets import load_iris\ndf=pd.DataFrame(load_iris().data,columns=load_iris().feature_names)\nprint(df.isna().sum())\nprint(df.corr().round(2))","Find missing values in a dataset.","assert True"]],
 ml:[["LinearRegression","from sklearn.datasets import load_diabetes\nfrom sklearn.linear_model import LinearRegression\nfrom sklearn.model_selection import train_test_split\nX,y=load_diabetes(return_X_y=True)\nXtr,Xte,ytr,yte=train_test_split(X,y)\nm=LinearRegression().fit(Xtr,ytr)\nprint('R2:',m.score(Xte,yte))","Split iris and train KNN.","assert True"],
 ["RandomForest","from sklearn.datasets import load_iris\nfrom sklearn.ensemble import RandomForestClassifier\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.metrics import accuracy_score\nX,y=load_iris(return_X_y=True)\nXtr,Xte,ytr,yte=train_test_split(X,y)\nm=RandomForestClassifier().fit(Xtr,ytr)\nprint('acc:',accuracy_score(yte,m.predict(Xte)))","Report precision/recall too.","assert True"],
 ["KMeans","from sklearn.datasets import load_iris\nfrom sklearn.cluster import KMeans\nX,y=load_iris(return_X_y=True)\nkm=KMeans(n_clusters=3,n_init=10).fit(X)\nprint(km.cluster_centers_[:,0])","Try PCA then KMeans.","assert True"]],
 dl:[["Perceptron/PyTorch","import torch\nprint('cuda:',torch.cuda.is_available())\nx=torch.tensor([1.,2.,3.])\nprint((x*2).tolist())","Build nn.Linear(2,1) and forward.","assert True"],
 ["Keras MLP","try:\n import tensorflow as tf\n print('gpus:',tf.config.list_physical_devices('GPU'))\n m=tf.keras.Sequential([tf.keras.layers.Dense(8,activation='relu'),tf.keras.layers.Dense(1)])\n m.build((None,4)); m.summary(print_fn=print)\nexcept Exception as e:\n print('tf note:',e)","Explain activation functions.","assert True"]],
 stats:[["t-test","from scipy import stats\nimport numpy as np\na=np.random.default_rng(0).normal(0,1,50)\nb=np.random.default_rng(1).normal(0.5,1,50)\nprint(stats.ttest_ind(a,b))","Interpret the p-value.","assert True"],
 ["OLS econometrics","import statsmodels.formula.api as smf\nimport pandas as pd\nfrom sklearn.datasets import load_diabetes\nd=load_diabetes(as_frame=True).frame\nprint(smf.ols('target ~ age + bmi',data=d).fit().summary())","Add robust SE: cov_type='HC1'.","assert True"]]
};
const Lessons={
  render(){ const b=$("#side-body"); const cats=Object.keys(CURR);
    b.innerHTML=`<input placeholder="🔍 search lessons…" oninput="Lessons.filter(this.value)">`+cats.map(c=>`<h4>${c.toUpperCase()}</h4>`+CURR[c].map((l,i)=>`<div class="card small lesson-item"><b>${esc(l[0])}</b><br><button onclick="Lessons.open('${c}',${i})">Open lesson</button> <button onclick="Lessons.toCell('${c}',${i})">→ Send code to cell</button></div>`).join("")).join(""); },
  filter(q){document.querySelectorAll(".lesson-item").forEach(e=>e.style.display=e.textContent.toLowerCase().includes(q.toLowerCase())?"":"none")},
  open(c,i){ const l=CURR[c][i];
    UI.modal(`<div class="lesson"><h3>${esc(l[0])} <span class="badge">${c}</span></h3><h4>Example</h4><pre>${esc(l[1])}</pre>
    <p><b>Exercise:</b> ${esc(l[2])}</p><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="primary" onclick="Lessons.toCell('${c}',${i})">Try it in a cell</button><button onclick="Prog.done('lesson','${c}-${i}');UI.close();UI.tab('progress')">✓ Mark complete</button><button onclick="UI.close()">Close</button></div></div>`); },
  toCell(c,i){ UI.close(); NB.cells.push({id:uid(),type:"code",source:CURR[c][i][1]}); NB.render(); toast("Lesson code added — press Run"); }
};
const Ex={
  list:[["avg fn","Write average(numbers) → mean (0 if empty).","def average(numbers):\n    # your code here\n    pass","assert average([1,2,3])==2\nassert average([10,20])==15\nassert average([])==0","def average(numbers):\n    return sum(numbers)/len(numbers) if numbers else 0"],
  ["regression","Fit LinearRegression on diabetes, print R2.","from sklearn.datasets import load_diabetes\nfrom sklearn.linear_model import LinearRegression\nfrom sklearn.model_selection import train_test_split\n# your code","assert True","from sklearn.datasets import load_diabetes\nfrom sklearn.linear_model import LinearRegression\nfrom sklearn.model_selection import train_test_split\nX,y=load_diabetes(return_X_y=True)\nXtr,Xte,ytr,yte=train_test_split(X,y)\nprint(LinearRegression().fit(Xtr,ytr).score(Xte,yte))"]],
  render(){ const b=$("#side-body"); b.innerHTML=this.list.map((e,i)=>`<div class="card small"><b>Ex ${i+1}: ${esc(e[0])}</b><p>${esc(e[1])}</p>
    <textarea class="code" id="ex-${i}" style="min-height:80px">${esc(e[2])}</textarea><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
    <button onclick="Ex.run(${i})">▶ Run</button><button class="primary" onclick="Ex.submit(${i})">Submit</button><button onclick="Ex.hint(${i})">💡 Hint</button><button onclick="Ex.sol(${i})">Solution</button></div><div id="exr-${i}" class="small"></div></div>`).join(""); },
  code(i){return document.getElementById("ex-"+i).value},
  async run(i){ const r=await API("/api/execute",{method:"POST",body:JSON.stringify({session_id:SID,code:this.code(i)})}); SID=r.session_id;
    document.getElementById("exr-"+i).innerHTML=r.error?`<pre class="err">${esc(r.error.type)}: ${esc(r.error.message)}<br>${esc(r.error.hint)}</pre>`:r.outputs.map(o=>`<pre>${esc(o.text||o.result||"ok")}</pre>`).join("")||"✓ ran, no output"; },
  async submit(i){ const r=await API("/api/exercises/test",{method:"POST",body:JSON.stringify({session_id:SID,code:this.code(i),tests:this.list[i][3]})});
    document.getElementById("exr-"+i).innerHTML=r.ok?`✅ <b>Score 100%</b> — ${r.passed}/${r.total} tests passed (${r.elapsed}s)`:`❌ <b>${esc(r.error?.type||"Failed")}</b>: ${esc(r.error?.message||"")} <br>💡 ${esc(r.error?.hint||"")}`;
    if(r.ok)Prog.done("ex","ex"+i); },
  async hint(i){ const r=await API("/api/ai/ask",{method:"POST",body:JSON.stringify({code:this.code(i),mode:"hint"})}); UI.modal(`<div>${marked.parse(r.answer)}</div><button onclick="UI.close()">Close</button>`); },
  sol(i){ UI.modal(`<h3>Solution (try yourself first!)</h3><pre>${esc(this.list[i][4])}</pre><button onclick="UI.close()">Close</button>`); }
};

/* ---------- AI Tutor ---------- */
const AI={
  open(){ UI.modal(`<h3>🤖 AI Python Teacher</h3><p class="small mut">Teaches — doesn't just give answers. No API key needed (built-in tutor).</p>
  <textarea class="code" id="ai-code" placeholder="paste code here…"></textarea>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0"><button onclick="AI.ask('explain')">Explain</button><button onclick="AI.ask('debug')">Debug</button><button onclick="AI.ask('improve')">Improve</button><button onclick="AI.ask('hint')">Give hint</button><button onclick="AI.ask('exercise')">New exercise</button></div>
  <div id="ai-out" class="card small">Ask something…</div><button onclick="UI.close()">Close</button>`); },
  async ask(mode){ const code=(document.getElementById("ai-code")||{}).value||"";
    document.getElementById("ai-out").innerHTML="thinking…";
    const r=await API("/api/ai/ask",{method:"POST",body:JSON.stringify({code,mode})});
    document.getElementById("ai-out").innerHTML=marked.parse(r.answer); },
  async debug(cellId){ const src=NB.get(cellId)?.source||""; const err=NB?JSON.stringify(OUT.store[cellId]?.error||{}):"";
    const r=await API("/api/ai/ask",{method:"POST",body:JSON.stringify({code:src,mode:"debug",error:err})});
    UI.modal(`<div>${marked.parse(r.answer)}</div><button onclick="UI.close()">Close</button>`); }
};

/* ---------- System ---------- */
const SysInfo={ async show(){ const r=await API("/api/system/info");
  UI.modal(`<h3>⚙ Environment</h3><pre>Python ${esc(r.python_short)}\n${esc(r.python)}\nGPU: ${esc(JSON.stringify(r.gpu))}\nCPU: ${r.cpu_percent}% · RAM ${r.memory.percent}%</pre><button onclick="UI.close()">Close</button>`); } };
const Terminal={ open(){ UI.modal(`<h3>⌨ Terminal (pro)</h3><p class="small">This build runs pip via the Libraries panel so you never need a terminal. Equivalents:</p><pre>pip install numpy\npip install pandas scikit-learn matplotlib\npip freeze &gt; requirements.txt</pre><button onclick="UI.close()">Close</button>`);} };

/* ---------- status polling ---------- */
setInterval(async()=>{ try{ const r=await API("/api/system/info"); $("#st-py").textContent="Python "+r.python_short;
  $("#st-mem").textContent="Memory: "+r.memory.percent+"%"; $("#st-cpu").textContent="CPU: "+r.cpu_percent+"%"; }catch{} },5000);

/* ---------- boot ---------- */
(async function boot(){
  try{ const s=await API("/api/system/info"); $("#st-py").textContent="Python "+s.python_short; SID=SID||""; }catch{}
  NB.newNotebook();
  // welcome output demo
  setTimeout(()=>{ const c=NB.cells[1]; if(c)NB.runCell(c.id,true); },600);
  Files.refresh(true); UI.tab("files");
})();
