// Route-local CSS for the lead map (keeps the global stylesheet at its budget, like
// the schedule map and the Assign hub). LEADS_MAP_CSS is the frame (phone region,
// drawer, Grid / Map switch, "Show N leads", the desktop panel) and ships with
// LeadsMap; PIN_CSS is the markers and ships in the lazy Leaflet chunk with the
// code that draws them. Motion: transform and opacity only, spring tokens,
// reduced motion = no movement.

export const LEADS_MAP_CSS = `.lm{position:relative}
.lm-slot{position:absolute;inset:0}
.lm-stage{position:absolute;inset:0;overflow:hidden;background:var(--card-2)}
.lm-mapwrap{position:absolute;inset:0;z-index:0;isolation:isolate}
.lm-mapwrap>.lm-canvas{position:absolute;inset:0}
.lm-phone{width:100vw;margin-left:calc(50% - 50vw);height:calc(100dvh - var(--lm-top,0px));min-height:320px;margin-bottom:calc(-1*var(--lm-below,0px))}
.lm-panel{--lm-sticky:calc(env(safe-area-inset-top) + 60px);position:sticky;top:var(--lm-sticky);height:calc(100dvh - var(--lm-sticky) - 16px);min-height:400px;border-radius:var(--radius-card);overflow:hidden;box-shadow:var(--shadow-card);isolation:isolate}
.lm-probe{position:absolute;visibility:hidden;pointer-events:none;width:0;height:var(--tabbar-space,0px)}
.lm-expand{position:absolute;z-index:1;top:12px;right:12px}
.lm-notes{position:absolute;z-index:1;top:12px;left:12px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;max-width:calc(100% - 84px)}
.lm-note{display:flex;flex-direction:column;max-width:100%;border-radius:18px;box-shadow:var(--shadow-raised),0 0 0 .5px var(--hairline)}
.lm-note>button{display:flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;text-align:left}
.lm-note ul{padding:0 12px 10px 32px;list-style:disc}
.lm-drawer{position:absolute;left:0;right:0;top:0;height:100%;z-index:2;display:flex;flex-direction:column;background:var(--bg);border-radius:24px 24px 0 0;box-shadow:0 -.5px 0 var(--hairline),0 -8px 28px rgb(0 0 0/.16);transform:translate3d(0,45%,0);transition:transform var(--dur-snappy) var(--ease-spring)}
.lm-drawer[data-drag]{transition:none;will-change:transform;user-select:none;-webkit-user-select:none}
.lm-drawer[data-detent=full]{border-radius:0}
.lm-drawer:not([data-detent=full]),.lm-drawer:not([data-detent=full]) *,.lm-dtop,.lm-dtop *{touch-action:pan-x}
.lm-dtop{flex:none;cursor:grab}
.lm-grab{display:flex;align-items:center;justify-content:center;width:100%;height:26px;border-radius:24px 24px 0 0;outline:none}
.lm-grab::before{content:"";width:36px;height:5px;border-radius:3px;background:var(--label-3);opacity:.7}
.lm-grab:focus-visible::before{outline:2px solid var(--accent);outline-offset:4px}
.lm-dhead{padding:0 16px 12px}
.lm-dbody{flex:1;min-height:0;overflow:hidden;padding:2px 16px calc(var(--tabbar-space,0px) + 16px);overscroll-behavior:contain}
.lm-drawer[data-detent=full] .lm-dbody{overflow-y:auto}
.lm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.lm-grid[data-cols="1"]{grid-template-columns:minmax(0,1fr);gap:12px}
.lm-switch{position:absolute;z-index:1;left:50%;top:-58px;transform:translateX(-50%);transition:opacity var(--dur-quick) var(--ease-out)}
.lm-drawer[data-detent=full] .lm-switch{top:auto;bottom:calc(var(--tabbar-space,0px) + 10px)}
.fs-hub[data-fs] .lm-expand,.fs-hub[data-fs] .lm-switch{opacity:0;pointer-events:none;visibility:hidden}
.lm-show{position:absolute;z-index:3;left:50%;bottom:24px;display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 22px 0 18px;border-radius:9999px;background:var(--label);color:var(--bg);white-space:nowrap;box-shadow:var(--shadow-float);transform:translate(-50%,40px);opacity:0;visibility:hidden;transition:transform var(--dur-bouncy) var(--ease-spring-bouncy),opacity var(--dur-quick) var(--ease-out),visibility 0s linear var(--dur-bouncy)}
.fs-hub[data-fs] .lm-show{transform:translate(-50%,0);opacity:1;visibility:visible;transition:transform var(--dur-bouncy) var(--ease-spring-bouncy) 120ms,opacity var(--dur-quick) var(--ease-out) 120ms,visibility 0s}
.lm-show:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.lm-empty{position:absolute;inset:0;z-index:1;display:grid;place-items:center;pointer-events:none;padding:0 24px}
@media (prefers-reduced-motion:reduce){.lm-drawer,.lm-switch{transition:none}.lm-show,.fs-hub[data-fs] .lm-show{transform:translate(-50%,0);transition:opacity 150ms linear,visibility 0s}}`;

export const PIN_CSS = `.lm-pin{background:none;border:0}
.lm-pin:focus-visible{outline:none}
.lm-pin:focus-visible .lm-p{outline:2px solid var(--accent);outline-offset:3px}
.lm-m{position:absolute;left:0;top:0;--r:20px}
.lm-p{position:absolute;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:var(--card);box-shadow:0 2px 8px rgb(0 0 0/.3);cursor:pointer;transition:transform var(--dur-quick) var(--ease-spring-snappy),box-shadow var(--dur-quick) var(--ease-out)}
.lm-ring{position:absolute;inset:0;transform:rotate(-90deg);transition:opacity var(--dur-quick) var(--ease-out)}
.lm-trk{fill:none;stroke:var(--fill);stroke-width:3}
.lm-arc{fill:none;stroke:var(--t,var(--sys-green));stroke-width:3;stroke-linecap:round;stroke-dasharray:var(--p,0) 100;transition:stroke-dasharray var(--dur-quick) var(--ease-out),stroke var(--dur-quick) var(--ease-out)}
.lm-m[data-ring="0"] .lm-arc{opacity:0}
.lm-av{position:absolute;inset:5px;display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font:600 12px/1 system-ui,sans-serif;letter-spacing:.01em;text-shadow:0 0 2px rgb(0 0 0/.25);background:linear-gradient(145deg,color-mix(in srgb,var(--c) 70%,#fff),var(--c) 55%,color-mix(in srgb,var(--c) 82%,#000));transition:color var(--dur-quick) var(--ease-out)}
.lm-m[data-mode=dot]{--r:11px}
.lm-m[data-mode=dot] .lm-p{transform:scale(.55)}
.lm-m[data-mode=dot] .lm-av{color:transparent;text-shadow:none}
.lm-m[data-mode=dot] .lm-ring{opacity:0}
.lm-m[data-sel]{--r:24px}
.lm-m[data-sel] .lm-p{transform:scale(1.2);box-shadow:0 0 0 3px var(--accent),0 6px 16px rgb(0 0 0/.35)}
@media (hover:hover){.lm-m:not([data-sel]):not([data-mode=dot]) .lm-p:hover{transform:scale(1.08)}}
.lm-m[data-pulse] .lm-p::after{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px solid var(--t,var(--sys-green));animation:lm-pulse 1.6s var(--ease-out) infinite;pointer-events:none}
@keyframes lm-pulse{0%{transform:scale(.92);opacity:.85}70%,100%{transform:scale(1.32);opacity:0}}
.lm-tag{position:absolute;display:none;white-space:nowrap;padding:3px 9px;border-radius:9999px;background:var(--card);color:var(--label);font:600 12px/16px system-ui,sans-serif;box-shadow:0 2px 8px rgb(0 0 0/.22),0 0 0 .5px var(--hairline);pointer-events:none}
.lm-m[data-tag] .lm-tag,.lm-m[data-measure] .lm-tag{display:block}
.lm-m[data-measure] .lm-tag{visibility:hidden}
.lm-m[data-tag=below] .lm-tag{top:calc(var(--r) + 6px);left:0;transform:translateX(-50%)}
.lm-m[data-tag=above] .lm-tag{bottom:calc(var(--r) + 6px);left:0;transform:translateX(-50%)}
.lm-m[data-tag=right] .lm-tag{left:calc(var(--r) + 6px);top:0;transform:translateY(-50%)}
.lm-m[data-tag=left] .lm-tag{right:calc(var(--r) + 6px);top:0;transform:translateY(-50%)}
.lm-j{position:absolute;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;display:flex;align-items:center;justify-content:center;border-radius:5px;background:var(--label);color:var(--bg);box-shadow:0 0 0 1.5px var(--card),0 2px 6px rgb(0 0 0/.3);cursor:default}
.lm-j[data-st=done]{opacity:.45}
.lm-j[data-st=live]::after{content:"";position:absolute;top:-3px;right:-3px;width:7px;height:7px;border-radius:50%;background:var(--sys-green);box-shadow:0 0 0 1.5px var(--card)}
.leaflet-tooltip.lm-tip{padding:4px 9px;border:0;border-radius:8px;background:var(--label);color:var(--bg);font:600 12px/16px system-ui,sans-serif;box-shadow:var(--shadow-raised)}
.leaflet-tooltip-top.lm-tip::before{border-top-color:var(--label)}
.lm-canvas .leaflet-bottom{transform:translateY(calc(-1*var(--lm-cover,0px)));transition:transform var(--dur-snappy) var(--ease-spring)}
.lm-canvas .leaflet-top.leaflet-right{top:46px}
.lm-canvas .leaflet-bar{border:0;box-shadow:var(--shadow-raised)}
.lm-canvas .leaflet-bar a{background:var(--card);color:var(--label);border-bottom-color:var(--sep)}
.lm-canvas .leaflet-bar a:hover{background:color-mix(in srgb,var(--card) 92%,var(--label))}
.lm-canvas .leaflet-container .leaflet-control-attribution{background:color-mix(in srgb,var(--card) 82%,transparent);color:var(--label-2)}
.lm-canvas .leaflet-control-attribution a{color:var(--accent-text)}
@media (prefers-reduced-motion:reduce){.lm-m[data-pulse] .lm-p::after{animation:none;opacity:0}.lm-p,.lm-canvas .leaflet-bottom{transition:none}}`;
