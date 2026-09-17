"""Viewer adapted from PackIT; original layout and interactions retained."""
from __future__ import annotations

import json
import pathlib

# JetBrains' built-in server. Present only while the IDE runs, so the open is offered as
# best-effort next to a path the user can always copy.
IDE_PORT = 63342

CSS = """
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:flex;font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;
     color:#0f172a;background:#e2e8f0;overflow:hidden}

#side{width:246px;flex:0 0 246px;background:#0f172a;color:#cbd5e1;display:flex;
      flex-direction:column;overflow:hidden}
#side h1{font-size:14px;margin:0;padding:14px 14px 4px;color:#f1f5f9;letter-spacing:.2px}
#side .sub{padding:0 14px 10px;font-size:10.5px;color:#64748b;line-height:1.4}
#filter{margin:0 14px 10px;padding:5px 8px;border-radius:5px;border:1px solid #334155;
        background:#1e293b;color:#e2e8f0;font:inherit;font-size:12px}
#filter::placeholder{color:#64748b}
#tree{flex:1;overflow-y:auto;padding:0 0 18px}
#tree .grp{font-size:10px;text-transform:uppercase;letter-spacing:.9px;color:#64748b;
           padding:12px 14px 4px}
#tree a{display:block;padding:4px 14px;color:#cbd5e1;text-decoration:none;
        font-size:12.2px;border-left:2px solid transparent;cursor:pointer}
#tree a:hover{background:#1e293b;color:#f8fafc}
#tree a.kid{padding-left:28px;font-size:11.6px;color:#94a3b8}
#tree a.on{background:#1e293b;color:#fff;border-left-color:#38bdf8}
#tree a.hide{display:none}

#main{flex:1;display:flex;flex-direction:column;min-width:0}
#bar{display:flex;align-items:flex-start;gap:10px;padding:8px 14px;background:#f8fafc;
     border-bottom:1px solid #cbd5e1;flex:0 0 auto;max-height:42vh;overflow-y:auto}
/* Wraps rather than truncating: the subtitle says what abstraction level the page is at and
   what it is for, which is unreadable as an ellipsis. */
#crumb{font-size:12.5px;color:#64748b;flex:1;min-width:0;white-space:normal;
       line-height:1.5;padding-top:2px}
#crumb b{color:#0f172a;font-weight:650}
/* What binds this region, beside its own map: the decisions that outrank the code and the
   numbers that came off hardware. The only two prose sections a spec may carry, and the only
   prose that belongs next to the drawing rather than behind a toggle. */
#binds{margin-top:6px;padding:7px 11px;background:#fff;border:1px solid #e2e8f0;
       border-radius:6px;font-size:12.5px;line-height:1.62;color:#334155;white-space:normal}
#binds:empty{display:none}
#binds p{margin:0 0 7px}
#binds p:last-child{margin:0}
#binds b,#binds strong{color:#0f172a}
#binds h3{margin:9px 0 4px;font-size:11px;font-weight:700;letter-spacing:.055em;
          text-transform:uppercase;color:#94a3b8}
#binds h3:first-child{margin-top:0}
#binds ul{margin:0;padding-left:17px}
#binds li{margin:0 0 4px}
#binds li:last-child{margin:0}
#binds code{font-family:ui-monospace,Consolas,monospace;background:#f1f5f9;
            padding:0 3px;border-radius:3px;font-size:11.5px}
#crumb span.up{color:#0369a1;cursor:pointer}
#crumb span.up:hover{text-decoration:underline}
#bar button{font:inherit;font-size:11.5px;padding:3px 9px;border:1px solid #cbd5e1;
            background:#fff;border-radius:5px;cursor:pointer;color:#334155}
#bar button:hover{background:#e2e8f0}
#zoom{font-size:11px;color:#94a3b8;min-width:42px;text-align:right}

#stage{flex:1;position:relative;overflow:hidden;background:#e2e8f0;cursor:grab}
#stage.drag{cursor:grabbing}
#canvas{position:absolute;top:0;left:0;transform-origin:0 0;
        filter:drop-shadow(0 2px 10px rgba(15,23,42,.18))}
#canvas svg{display:block}
.fm-node[data-anchor] rect:first-of-type,
.fm-node[data-ref] rect:first-of-type,
.fm-node[data-explodes] rect:first-of-type{cursor:pointer}
.fm-node[data-anchor]:hover rect:first-of-type,
.fm-node[data-explodes]:hover rect:first-of-type{stroke-width:3.4}
/* A containment row is a transparent hit-rect over a line of text, so it shows it is live
   by tinting rather than by thickening a stroke it does not have. */
.fm-row:hover rect:first-of-type{fill:#e0f2fe}
.fm-row rect:first-of-type{cursor:pointer}
.fm-node.sel rect:first-of-type{stroke:#0284c7;stroke-width:3.6}
/* Presentation attributes lose to any CSS rule, so `hot` overrides the drawn stroke-width
   and the wrap wire's recessive opacity without the renderer knowing about hover. */
.fm-edge.hot{stroke-width:3.4;opacity:1}
.fm-elab.hot text{font-weight:700}
.fm-elab.hot rect{opacity:1}

#panel{position:absolute;right:16px;bottom:16px;width:340px;max-height:72%;
       overflow-y:auto;background:#fff;border:1px solid #cbd5e1;border-radius:9px;
       box-shadow:0 6px 26px rgba(15,23,42,.22);padding:13px 15px;display:none}
#panel.on{display:block}
#panel .x{float:right;cursor:pointer;color:#94a3b8;font-size:15px;line-height:1}
#panel .x:hover{color:#0f172a}
#panel .num{font-size:11px;color:#94a3b8;font-weight:700}
#panel h3{margin:1px 0 6px;font-size:15px}
#panel .kind{display:inline-block;font-size:10px;text-transform:uppercase;
             letter-spacing:.7px;padding:1px 6px;border-radius:9px;background:#f1f5f9;
             color:#475569;margin-bottom:8px}
#panel .note{color:#64748b;font-size:12px;margin:0 0 9px}
#panel .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:#94a3b8;
            margin:10px 0 3px}
#panel code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;
            background:#f1f5f9;padding:2px 5px;border-radius:4px;word-break:break-all;
            display:block}
#panel button{font:inherit;font-size:11.5px;margin:8px 6px 0 0;padding:4px 10px;
              border:1px solid #cbd5e1;background:#fff;border-radius:5px;cursor:pointer;
              color:#334155}
#panel button:hover{background:#f1f5f9}
#panel button.go{background:#0284c7;border-color:#0284c7;color:#fff}
#panel button.go:hover{background:#0369a1}
#panel .say{font-size:11px;color:#64748b;margin-top:7px;min-height:14px}
#stage.doc{overflow:auto;cursor:auto;background:#f1f5f9}
#stage.doc #canvas{position:static;transform:none!important;filter:none;
                   max-width:940px;margin:0 auto;padding:26px 30px 60px}
#doc h2{font-size:19px;margin:26px 0 4px}
#doc h3{font-size:12px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;
        margin:22px 0 8px}
#doc p{margin:0 0 12px;color:#334155;max-width:70ch}
#doc .card{background:#fff;border:1px solid #cbd5e1;border-radius:9px;padding:12px 14px;
           margin:0 0 10px}
#doc .card b{cursor:pointer;color:#0369a1}
#doc .card b:hover{text-decoration:underline}
#doc .files{margin-top:6px;font-size:11.5px;color:#64748b;
            font-family:ui-monospace,Consolas,monospace;line-height:1.7}
#doc .files span{background:#f1f5f9;border-radius:4px;padding:1px 6px;margin-right:5px;
                 white-space:nowrap;display:inline-block}
#doc code{font-family:ui-monospace,Consolas,monospace;background:#e2e8f0;
          border-radius:4px;padding:1px 5px;font-size:12px}
#docpane{position:absolute;right:0;top:0;bottom:0;width:520px;max-width:52%;
         background:#fff;border-left:1px solid #cbd5e1;box-shadow:-6px 0 22px
         rgba(15,23,42,.13);display:none;flex-direction:column}
#docpane.on{display:flex}
#docpane .dh{flex:0 0 auto;padding:9px 14px;border-bottom:1px solid #e2e8f0;
             background:#f8fafc;font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
#docpane .dh .x{float:right;cursor:pointer;color:#94a3b8;font-size:15px;line-height:1;
                font-family:system-ui}
#docpane .db{flex:1;overflow-y:auto;padding:6px 20px 40px}
#docpane h2{font-size:17px;margin:20px 0 6px}
#docpane h3{font-size:14px;margin:18px 0 5px}
#docpane h4,#docpane h5{font-size:12.5px;margin:14px 0 4px;color:#334155}
#docpane p,#docpane li{font-size:12.5px;line-height:1.55;color:#334155}
#docpane ul{margin:6px 0 10px;padding-left:20px}
#docpane code{font-family:ui-monospace,Consolas,monospace;background:#f1f5f9;
              border-radius:3px;padding:1px 4px;font-size:11.5px}
#docpane table{border-collapse:collapse;margin:8px 0 14px;font-size:11.5px;width:100%}
#docpane th,#docpane td{border:1px solid #e2e8f0;padding:3px 7px;text-align:left}
#docpane th{background:#f8fafc}
/* The code a box IS, beside the box. Same slot as the doc pane and mutually exclusive
   with it: both answer "what is behind this page", and two of them side by side would
   leave the drawing a sliver. Wider than the doc pane because a Kotlin line is. */
#codepane{position:absolute;right:0;top:0;bottom:0;width:660px;max-width:62%;
          background:#fff;border-left:1px solid #cbd5e1;box-shadow:-6px 0 22px
          rgba(15,23,42,.13);display:none;flex-direction:column}
#codepane.on{display:flex}
#codepane .ch{flex:0 0 auto;padding:9px 15px 11px;border-bottom:1px solid #e2e8f0;
              background:#f8fafc}
#codepane .ch .x{float:right;cursor:pointer;color:#94a3b8;font-size:15px;line-height:1}
#codepane .ch .x:hover{color:#0f172a}
#codepane .ch .num{font-size:11px;color:#94a3b8;font-weight:700}
#codepane .ch h3{margin:1px 0 6px;font-size:15px}
#codepane .ch .kind{display:inline-block;font-size:10px;text-transform:uppercase;
                    letter-spacing:.7px;padding:1px 6px;border-radius:9px;
                    background:#f1f5f9;color:#475569;margin:0 5px 7px 0}
#codepane .ch .note{color:#64748b;font-size:12px;margin:0 0 8px}
#codepane .ch .warn{color:#92400e;background:#fef3c7;border-radius:5px;padding:4px 8px;
                    font-size:11.5px;margin:0 0 8px}
#codepane .ch code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;
                   background:#f1f5f9;padding:2px 6px;border-radius:4px}
#codepane .ch button{font:inherit;font-size:11.5px;margin:8px 6px 0 0;padding:4px 10px;
                     border:1px solid #cbd5e1;background:#fff;border-radius:5px;
                     cursor:pointer;color:#334155}
#codepane .ch button:hover{background:#f1f5f9}
#codepane .cb{flex:1;overflow:auto;background:#fff}
#codepane pre{margin:0;padding:10px 14px 30px 0;font-family:ui-monospace,Consolas,monospace;
              font-size:11.5px;line-height:1.55;color:#0f172a;white-space:pre;
              tab-size:4}
/* The gutter carries the file's own line numbers, so a box's foot (`File.kt:483-502`) and
   what is on screen are the same coordinates. */
#codepane .ln{display:inline-block;width:56px;padding-right:14px;margin-right:12px;
              text-align:right;color:#94a3b8;border-right:1px solid #e2e8f0;
              user-select:none;-webkit-user-select:none}

#hint{position:absolute;left:16px;bottom:14px;font-size:11px;color:#64748b;
      background:rgba(255,255,255,.82);padding:3px 8px;border-radius:5px}
"""

JS = """
const stage=document.getElementById('stage'),canvas=document.getElementById('canvas'),
      panel=document.getElementById('panel'),crumb=document.getElementById('crumb'),
      zoomLbl=document.getElementById('zoom'),srcBtn=document.getElementById('srcbtn'),
      docBtn=document.getElementById('docbtn'),docPane=document.getElementById('docpane'),
      codePane=document.getElementById('codepane');
let view={x:0,y:0,k:1},cur=null;

function apply(){canvas.style.transform=
  `translate(${view.x}px,${view.y}px) scale(${view.k})`;
  zoomLbl.textContent=Math.round(view.k*100)+'%';}

function fit(){const s=canvas.firstElementChild;if(!s)return;
  const w=s.width.baseVal.value,h=s.height.baseVal.value,
        r=stage.getBoundingClientRect(),
        k=Math.min((r.width-48)/w,(r.height-48)/h);
  view.k=Math.min(k,1);
  view.x=(r.width-w*view.k)/2;view.y=(r.height-h*view.k)/2;apply();}

function actual(){const r=stage.getBoundingClientRect(),s=canvas.firstElementChild;
  view.k=1;view.x=(r.width-s.width.baseVal.value)/2;view.y=24;apply();}

function show(key,keepView){const p=PAGES[key];if(!p)return;
  canvas.innerHTML=document.getElementById('svg-'+key).textContent;
  cur=key;hotId=null;closePanel();
  stage.classList.toggle('doc',!!p.doc);
  document.querySelectorAll('#tree a').forEach(a=>
    a.classList.toggle('on',a.dataset.key===key));
  let up='';
  if(p.parent) up=`<span class="up" onclick="show('${p.parent.key}')">`+
                  `${PAGES[p.parent.key].title}</span> &rsaquo; `;
  crumb.innerHTML=up+`<b>${p.title}</b>`+(p.subtitle?` — ${p.subtitle}`:'');
  srcBtn.style.display=(p.sources&&p.sources.length)?'':'none';
  docBtn.style.display=p.spec?'':'none';
  docPane.classList.remove('on');closeCode();
  if(p.doc){canvas.style.transform='';zoomLbl.textContent='';stage.scrollTop=0;return;}
  if(!keepView) fit();else apply();}

/* Which source files this page's boxes come from. Not a doc and not a guess: a leveled
   page's anchors name the files, a sheet's leaves are resolved by flow_index. */
function sources(){const p=PAGES[cur];if(!p.sources)return;closeCode();
  let h=`<span class="x" onclick="closePanel()">&times;</span>`+
        `<h3>Draws from</h3><div class="kind">${p.sources.length} source files</div>`;
  for(const [path,n] of p.sources)
    h+=`<div style="margin:5px 0"><code>${path}</code>`+
       `<span style="color:#94a3b8;font-size:11px"> &nbsp;${n} box${n>1?'es':''}</span></div>`;
  h+=`<div class="say" id="say"></div>`;
  panel.innerHTML=h;panel.classList.add('on');}

/* -- hover: the box, and every wire touching it ---------------------------- */
/* A box's neighbourhood is the thing the drawing is for, and on a page of 20 wires the
   one leaving the box under the cursor is not findable by eye. Delegated on the stage so
   it survives `show` replacing the whole SVG. */
let hotId=null;
function hover(id){if(id===hotId)return;
  canvas.querySelectorAll('.hot').forEach(el=>el.classList.remove('hot'));
  hotId=id;if(!id)return;
  const q=`[data-a="${id}"],[data-b="${id}"]`;
  canvas.querySelectorAll(q).forEach(el=>el.classList.add('hot'));}

stage.addEventListener('pointerover',e=>{
  const at=document.elementFromPoint(e.clientX,e.clientY),g=at&&at.closest('.fm-node');
  hover(g?g.dataset.id:null);});
stage.addEventListener('pointerleave',()=>hover(null));

/* -- pan / zoom ------------------------------------------------------------ */
stage.addEventListener('wheel',e=>{if(PAGES[cur].doc)return;e.preventDefault();
  const r=stage.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,
        nk=Math.min(8,Math.max(.04,view.k*Math.exp(-e.deltaY*.0015)));
  view.x=mx-(mx-view.x)*(nk/view.k);view.y=my-(my-view.y)*(nk/view.k);
  view.k=nk;apply();},{passive:false});

let down=null,moved=false;
stage.addEventListener('pointerdown',e=>{if(PAGES[cur].doc)return;down={x:e.clientX,y:e.clientY,
  vx:view.x,vy:view.y};moved=false;stage.setPointerCapture(e.pointerId);
  stage.classList.add('drag');});
stage.addEventListener('pointermove',e=>{if(!down)return;
  const dx=e.clientX-down.x,dy=e.clientY-down.y;
  if(Math.abs(dx)+Math.abs(dy)>4)moved=true;
  view.x=down.vx+dx;view.y=down.vy+dy;apply();});
stage.addEventListener('pointerup',e=>{down=null;stage.classList.remove('drag');});

/* A drag that ends over a box is a pan, not a click on it. Code wins over the panel
   wherever there is code: a leveled box's foot resolves one way or the other -- `>page` or
   `@anchor`, never both -- so only an exploding box reaches the panel.

   The box is hit-tested rather than read off `e.target`: `pointerdown` captures the pointer
   so a drag leaving the stage keeps panning, and a captured pointer retargets the click that
   follows to the capture element, making `e.target` always #stage. Confirmed 2026-08-20 on
   Edge 151 by driving real input -- as shipped the listener saw `stage`; with
   `setPointerCapture` neutered and nothing else changed it saw the box. */
stage.addEventListener('click',e=>{if(moved)return;
  const at=document.elementFromPoint(e.clientX,e.clientY),
        g=at&&at.closest('.fm-node');
  const live=g&&(g.dataset.anchor||g.dataset.explodes||CODE[g.dataset.ref]);
  if(!live){closePanel();closeCode();return;}
  document.querySelectorAll('.fm-node.sel').forEach(n=>n.classList.remove('sel'));
  g.classList.add('sel');
  if(CODE[g.dataset.ref]){closePanel(true);openCode(g.dataset);}
  else{closeCode();openPanel(g.dataset);}});

/* -- the detail panel ------------------------------------------------------ */
/* `keepSel` when the code pane is taking over for the same box: the box stays selected,
   and the panel is emptied rather than hidden so its `say` line is not a second element
   with that id while the pane carries one. */
function closePanel(keepSel){panel.classList.remove('on');panel.innerHTML='';
  if(!keepSel)document.querySelectorAll('.fm-node.sel')
    .forEach(n=>n.classList.remove('sel'));}

function openPanel(d){
  let h=`<span class="x" onclick="closePanel()">&times;</span>`+
        (d.num?`<div class="num">${d.num}</div>`:'')+
        `<h3>${d.label}</h3><div class="kind">${d.kind}</div>`;
  if(d.note)h+=`<p class="note">${d.note}</p>`;
  if(d.explodes)h+=`<div class="lbl">opens</div><code>${d.explodes}</code>`+
    `<button class="go" onclick="show('${d.explodes}')">Descend &#9656;</button>`;
  if(d.anchor){h+=`<div class="lbl">is this code</div><code>${d.src||d.ref}`+
    `${d.line?':'+d.line:''}</code>`+
    `<div class="lbl">anchor</div><code>${d.anchor}</code>`+
    `<button onclick="copy(this,'${d.src}:${d.line}')">Copy path:line</button>`+
    `<button onclick="ide('${d.src}',${d.line||1})">Open in IDE</button>`;}
  h+=`<div class="say" id="say"></div>`;
  panel.innerHTML=h;panel.classList.add('on');}

/* -- the code pane --------------------------------------------------------- */
function esc(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

function closeCode(){codePane.classList.remove('on');codePane.innerHTML='';}

/* The block the box IS, at the file's own line numbers. A `gap` box is the one case where
   the anchor is wider than the box -- it names the declaration that ENCLOSES a step with no
   name of its own -- and the pane says so rather than letting the extra lines read as the
   box's own. */
function openCode(d){const c=CODE[d.ref];if(!c)return;
  docPane.classList.remove('on');
  let rows='',lines=c.t.split('\\n');
  for(let i=0;i<lines.length;i++)
    rows+=`<span class="ln">${c.a+i}</span>${esc(lines[i])}\\n`;
  codePane.innerHTML=
    `<div class="ch"><span class="x" onclick="closeCode()">&times;</span>`+
    (d.num?`<div class="num">${d.num}</div>`:'')+
    `<h3>${d.label}</h3>`+
    `<span class="kind">${d.kind}</span>`+(d.co?`<span class="kind">${d.co}</span>`:'')+
    (d.note?`<p class="note">${d.note}</p>`:'')+
    (d.kind==='gap'?`<p class="warn">This step has no name of its own. The lines below are `+
      `the declaration that encloses it, which is why they are wider than the box.</p>`:'')+
    (d.kind==='unclaimed'?`<p class="warn">No box on any page points at this. It is `+
      `code the map does not draw.</p>`:'')+
    `<code>${c.src}:${d.ref.split(':')[1]}</code>`+
    `<div><button onclick="copy(this,'${c.src}:${c.a}')">Copy path:line</button>`+
    `<button onclick="ide('${c.src}',${c.a})">Open in IDE</button>`+
    `<button onclick="copyCode()">Copy block</button>`+
    `<div class="say" id="say"></div></div></div>`+
    `<div class="cb"><pre>${rows}</pre></div>`;
  codePane.dataset.ref=d.ref;codePane.classList.add('on');}

function copyCode(){const c=CODE[codePane.dataset.ref];if(!c)return;
  navigator.clipboard.writeText(c.t).then(()=>say(c.t.split('\\n').length+' lines copied'))
    .catch(()=>say('clipboard refused'));}

function copy(btn,t){navigator.clipboard.writeText(t)
  .then(()=>say(t+' copied')).catch(()=>say('clipboard refused — '+t));}

function say(m){const s=document.getElementById('say');if(s)s.textContent=m;}

/* Best-effort: the IDE's built-in server exists only while it runs, and from a file://
   page the response is opaque, so a resolved promise means "reached it", nothing more. */
function ide(src,line){
  fetch(`http://localhost:${IDE_PORT}/api/file/${src}:${line}`,{mode:'no-cors'})
    .then(()=>say('asked the IDE to open '+src+':'+line))
    .catch(()=>say('no IDE listening on '+IDE_PORT+' — copy the path instead'));}

/* The region spec's prose, beside its own map. One file is both, so the viewer shows
   both -- the human reads here what the agent reads in the file. */
function toggleDoc(){const p=PAGES[cur];if(!p.spec)return;
  if(docPane.classList.contains('on')){docPane.classList.remove('on');return;}
  closeCode();
  docPane.innerHTML=`<div class="dh"><b>${p.spec}</b>`+
    `<span class="x" onclick="toggleDoc()">&times;</span></div>`+
    `<div class="db">${document.getElementById('doc-'+p.spec).innerHTML}</div>`;
  docPane.classList.add('on');}

/* -- chrome ---------------------------------------------------------------- */
document.getElementById('filter').addEventListener('input',e=>{
  const q=e.target.value.toLowerCase();
  document.querySelectorAll('#tree a').forEach(a=>
    a.classList.toggle('hide',!!q&&!a.textContent.toLowerCase().includes(q)));});

addEventListener('keydown',e=>{
  if(e.target.id==='filter'||!cur)return;
  if(e.key==='Escape'){closePanel();closeCode();}
  if(e.key==='f')fit();
  if(e.key==='0')actual();
  if((e.key==='Backspace'||e.key==='u')&&PAGES[cur].parent)show(PAGES[cur].parent.key);});
/* No refit on resize: it would throw away wherever the reader had panned to. `f` refits. */

show(FIRST);
"""


def _js(obj) -> str:
    """JSON for a <script> body. A source line containing `</script>` would close the block
    early, so the sequence is broken the way it has to be broken in HTML."""
    return json.dumps(obj).replace("</", r"<\/")


def md_to_html(text):
    """Enough Markdown for a region spec's prose: headings, lists, tables, paragraphs and
    inline code/bold/italic. The spec is the documentation, so the viewer has to show it --
    the human reads the map and the prose in one place, the same way the agent does."""
    import html as _h
    import re as _re

    def inline(t):
        t = _h.escape(t)
        t = _re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
        t = _re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", t)
        t = _re.sub(r"(?<![*\w])\*([^*]+)\*", r"<i>\1</i>", t)
        return t

    out, para, rows, lst, item = [], [], [], False, []

    def close_item():
        """Emit the bullet being accumulated. Wrapped bullets are the common case in a
        region spec, and a run of `**bold**` routinely spans the wrap, so an item's lines
        are joined before any inline markup is read rather than rendered one at a time."""
        nonlocal item
        if item:
            out.append("<li>" + inline(" ".join(item)) + "</li>")
            item = []

    def flush():
        nonlocal para, rows, lst
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para = []
        if rows:
            body = ""
            for i, r in enumerate(rows):
                cells = [c.strip() for c in r.strip().strip("|").split("|")]
                if set("".join(cells)) <= set("-: "):
                    continue
                tag = "th" if i == 0 else "td"
                body += "<tr>" + "".join(f"<{tag}>{inline(c)}</{tag}>" for c in cells) + "</tr>"
            out.append(f"<table>{body}</table>")
            rows = []
        if lst:
            close_item()
            out.append("</ul>")
            lst = False

    for line in text.splitlines():
        st = line.strip()
        if st.startswith("|"):
            if not rows:
                flush()
            rows.append(st)
            continue
        if rows:
            flush()
        if not st:
            flush()
        elif st.startswith("#"):
            flush()
            lvl = len(st) - len(st.lstrip("#"))
            out.append(f"<h{min(lvl + 1, 5)}>{inline(st.lstrip('# '))}</h{min(lvl + 1, 5)}>")
        elif st.startswith(("- ", "* ")):
            close_item()
            if not lst:
                flush()
                out.append("<ul>")
                lst = True
            item.append(st[2:])
        elif lst and line[:1] in (" ", "	"):
            # Indented under the bullet above: its continuation, not a new paragraph.
            item.append(st)
        else:
            if lst:
                flush()
            para.append(st)
    flush()
    return "".join(out)


def emit(out: pathlib.Path, sections, specs=None, ide_port: int = IDE_PORT, dest=None,
         blobs=None, code=None):
    """Inline diagrams, region prose and resolved source blocks for offline viewing."""
    sections = list(sections)
    blobs_extra = {}

    pages, tree, first = {}, [], None
    for group, entries in sections:
        tree.append(f'<div class="grp">{group}</div>')
        for p in entries:
            pages[p["key"]] = {k: p.get(k) for k in ("title", "subtitle", "parent",
                                                     "sources", "spec")}
            cls = "kid" if p.get("kid") else ""
            # Indent by nesting depth, so a page under a page reads as one.
            pad = f' style="padding-left:{14 + 14 * p.get("depth", 0)}px"' if p.get("kid") else ""
            tree.append(f'<a class="{cls}"{pad} data-key="{p["key"]}" '
                        f'onclick="show(\'{p["key"]}\')">{p["title"]}</a>')
            first = first or p["key"]

    made = dict(blobs_extra)
    made.update(blobs or {})            # rendered in memory, never written to disk
    blobs = []
    for key in pages:
        body = made.get(key)
        if body is None:
            body = (out / f"{key}.svg").read_text(encoding="utf-8")
        blobs.append(f'<script type="text/html" id="svg-{key}">{body}</script>')
    for path, prose in (specs or {}).items():
        blobs.append(f'<div id="doc-{path}" style="display:none">'
                     f'{md_to_html(prose)}</div>')

    html = f"""<!doctype html><meta charset="utf-8"><title>SAAM flow map</title>
<style>{CSS}</style>
<div id="side">
  <h1>SAAM — flow map</h1>
  <div class="sub">Generated by <code>node scripts/dev-map.mjs</code>.
    Click a box for its code; a <b>&#9656;</b> foot descends.</div>
  <input id="filter" placeholder="filter pages…" autocomplete="off">
  <div id="tree">{''.join(tree)}</div>
</div>
<div id="main">
  <div id="bar">
    <div id="crumb"></div>
    <button id="docbtn" onclick="toggleDoc()">Doc</button>
    <button id="srcbtn" onclick="sources()">Sources</button>
    <button onclick="fit()">Fit</button>
    <button onclick="actual()">100%</button>
    <span id="zoom"></span>
  </div>
  <div id="stage"><div id="canvas"></div>
    <div id="docpane"></div>
    <div id="codepane"></div>
    <div id="panel"></div>
    <div id="hint">scroll = zoom · drag = pan · click a box = its code ·
      f fit · 0 actual · u up · esc close</div>
  </div>
</div>
{''.join(blobs)}
<script>
const PAGES={json.dumps(pages)}, FIRST={json.dumps(first)}, IDE_PORT={ide_port};
const CODE={_js(code or {})};
{JS}
</script>
"""
    path = (dest or out) / "index.html"
    path.write_text(html, encoding="utf-8")
    return path, len(html)
