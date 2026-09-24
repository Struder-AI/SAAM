"""Shared viewer stylesheet, adapted from PackIT; the original look is retained."""
from __future__ import annotations

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
/* What binds this node, beside its own map: the decisions that outrank the code and the
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
#docpane table,#doc table{border-collapse:collapse;margin:8px 0 14px;font-size:11.5px;width:100%}
#docpane th,#docpane td,#doc th,#doc td{border:1px solid #e2e8f0;padding:3px 7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
#docpane th,#doc th{background:#f8fafc}
#docpane pre,#doc pre{overflow:auto;padding:12px;background:#e2e8f0;border-radius:5px;white-space:pre}
#docpane pre code,#doc pre code{padding:0;background:transparent;border-radius:0}
#docpane p,#docpane li,#doc p,#doc li{overflow-wrap:anywhere}
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
