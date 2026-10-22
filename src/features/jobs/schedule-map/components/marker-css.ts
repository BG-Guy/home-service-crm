// Map marker and start pin styles for the schedule map (route lines and arrows:
// the shared map/route-draw.ts). Rendered by MapCanvas, so they ship in the lazy
// Leaflet chunk with the code that draws them.
export const MARKER_CSS = `.sm-off{position:absolute;z-index:500;top:10px;left:50%;transform:translateX(-50%);max-width:calc(100% - 24px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sm-pin{background:none;border:0}
.sm-pin:focus-visible{outline:none}
.sm-pin:focus-visible .sm-box,.sm-pin:focus-visible .sm-dot{outline:2px solid var(--accent);outline-offset:2px}
.sm-m{position:absolute;left:0;top:0;transition:opacity var(--dur-quick) var(--ease-out)}
.sm-m[data-fade]{opacity:.25}
.sm-dot{position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:var(--c);color:#fff;font:700 11px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;text-shadow:0 0 2px rgb(0 0 0/.35);box-shadow:0 0 0 2px #fff,0 1px 4px rgb(0 0 0/.35);cursor:pointer;transition:transform var(--dur-quick) var(--ease-spring-snappy)}
.sm-box{position:absolute;left:0;bottom:7px;transform:translateX(-50%);display:none;flex-direction:column;gap:1px;min-width:60px;max-width:136px;padding:5px 9px 6px 7px;border-radius:10px;background:var(--card);color:var(--label);box-shadow:0 0 0 2px var(--c),0 3px 10px rgb(0 0 0/.22);white-space:nowrap;cursor:pointer;text-align:left}
.sm-box::after{content:"";position:absolute;left:50%;bottom:-5px;width:9px;height:9px;margin-left:-4.5px;background:var(--card);transform:rotate(45deg);box-shadow:2px 2px 0 0 var(--c)}
.sm-b1{display:flex;align-items:center;gap:5px;font:700 12px/15px system-ui,sans-serif;font-variant-numeric:tabular-nums}
.sm-n{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--c);color:#fff;font:700 10px/1 system-ui,sans-serif;text-shadow:0 0 2px rgb(0 0 0/.3)}
.sm-b2{max-width:120px;overflow:hidden;text-overflow:ellipsis;font:500 11px/14px system-ui,sans-serif;color:var(--label-2)}
.sm-m[data-mode=box] .sm-box,.sm-m:hover .sm-box,.sm-m[data-hover] .sm-box{display:flex}
.sm-m[data-measure] .sm-box{display:flex;visibility:hidden}
.sm-m[data-mode=box] .sm-dot,.sm-m:hover .sm-dot,.sm-m[data-hover] .sm-dot{min-width:9px;width:9px;height:9px;padding:0;font-size:0;text-shadow:none}
.sm-m:hover,.sm-m[data-hover],.sm-m[data-sel]{opacity:1}
.sm-m[data-hover]:not([data-sel]) .sm-box{box-shadow:0 0 0 2.5px var(--c),0 0 0 6px color-mix(in srgb,var(--c) 24%,transparent),0 4px 14px rgb(0 0 0/.25)}
.sm-late{margin-left:3px;padding:1px 4px;border-radius:4px;background:var(--sys-red);color:#fff;font:700 10px/12px system-ui,sans-serif}
.sm-m[data-sel] .sm-box{box-shadow:0 0 0 3px var(--c),0 0 0 6px color-mix(in srgb,var(--c) 28%,transparent),0 6px 18px rgb(0 0 0/.28)}
.sm-m[data-sel] .sm-dot{transform:translate(-50%,-50%) scale(1.15)}
.sm-m[data-st~=done] .sm-box{background:color-mix(in srgb,var(--card) 82%,var(--fill))}
.sm-m[data-st~=done] .sm-b1,.sm-m[data-st~=done] .sm-b2{color:var(--label-2)}
.sm-m[data-st~=done] .sm-dot{background:color-mix(in srgb,var(--c) 45%,#8e8e93)}
.sm-m[data-st~=late] .sm-box{box-shadow:0 0 0 2.5px var(--sys-red),0 3px 10px rgb(0 0 0/.22)}
.sm-m[data-st~=late] .sm-box::after{box-shadow:2.5px 2.5px 0 0 var(--sys-red)}
.sm-m[data-st~=late] .sm-dot{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--sys-red),0 1px 4px rgb(0 0 0/.35)}
.sm-m[data-st~=un] .sm-box{box-shadow:0 3px 10px rgb(0 0 0/.18);outline:2px dashed var(--sys-gray);outline-offset:-1px}
.sm-m[data-st~=un] .sm-box::after{box-shadow:none;border-right:2px dashed var(--sys-gray);border-bottom:2px dashed var(--sys-gray)}
.sm-m[data-st~=un] .sm-dot{background:var(--card);border:2px dashed var(--sys-gray);box-shadow:0 1px 4px rgb(0 0 0/.3)}
.sm-canvas .leaflet-bar{border:0;box-shadow:var(--shadow-raised)}
.sm-canvas .leaflet-bar a{background:var(--card);color:var(--label);border-bottom-color:var(--sep)}
.sm-canvas .leaflet-bar a:hover{background:color-mix(in srgb,var(--card) 92%,var(--label))}
.sm-canvas .leaflet-container .leaflet-control-attribution{background:color-mix(in srgb,var(--card) 82%,transparent);color:var(--label-2)}
.sm-canvas .leaflet-control-attribution a{color:var(--accent-text)}
.sm-m[data-pulse] .sm-box::before,.sm-m[data-pulse] .sm-dot::before{content:"";position:absolute;inset:-4px;border-radius:14px;border:2px solid var(--c);animation:sm-ring 1.6s var(--ease-out) infinite;pointer-events:none}
@keyframes sm-ring{0%{transform:scale(1);opacity:.7}70%,100%{transform:scale(1.14);opacity:0}}
.sm-start{position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:7px;background:var(--card);color:var(--c);box-shadow:0 0 0 2px var(--c),0 1px 4px rgb(0 0 0/.3)}
.sm-start[data-fade]{opacity:.25}
@media (prefers-reduced-motion:reduce){.sm-m[data-pulse] .sm-box::before,.sm-m[data-pulse] .sm-dot::before{animation:none;opacity:0}.sm-dot{transition:none}}`;
