// Route-local CSS for the schedule map view (keeps the global stylesheet at its
// budget, like the Assign hub). Layout follows the view's own width (container
// queries, since the sidebar takes 256 px): phone < 640 ≤ tablet < 1060 ≤ desktop.
// Marker, route arrow and timeline styles live here too, so the lazy Leaflet
// chunk only carries Leaflet.
/** Timeline label buckets (px of the bar's content box), see DayTimeline. */
export const FIT_MIN = 24;
export const FIT_MAX = 128;
const fits = () => {
  let css = "";
  for (let n = FIT_MIN; n <= FIT_MAX; n += 8)
    css += `@container (min-width:${n}px){.tl-bar[data-fit="${n}"] .tl-full{display:inline}.tl-bar[data-fit="${n}"] .tl-short{display:none}}`;
  return css;
};

export const SMAP_CSS = `.smap{container-type:inline-size;--sm-left:268px;--sm-right:356px;--sm-gap:14px}
.smap-grid{display:flex;flex-direction:column;gap:12px}
.smap-left,.smap-right,.smap-panel-btn{display:none}
.smap-map{position:relative;height:45dvh;min-height:260px;margin:0 calc(-1*var(--gutter));overflow:hidden;background:var(--card-2);isolation:isolate}
.smap-mapwrap,.smap-mapwrap>.sm-canvas{position:absolute;inset:0}
.fs-hub[data-fs] .smap-fsbody{display:flex;flex-direction:column}
.fs-hub[data-fs] .smap-mapwrap{position:relative;inset:auto;flex:1;min-height:0}
.smap-fstl{flex:none;background:var(--bar);-webkit-backdrop-filter:saturate(180%) blur(24px);backdrop-filter:saturate(180%) blur(24px);box-shadow:0 -.5px 0 var(--sep)}
.smap-fshandle{display:flex;flex-direction:column;align-items:center;gap:5px;width:100%;padding:6px 0 9px;font-size:13px;line-height:16px;font-weight:600;color:var(--label-2)}
.smap-grip{width:36px;height:5px;border-radius:3px;background:var(--fill)}
.smap-fstl-body{max-height:min(40dvh,320px);overflow:auto;padding:0 8px 8px}
.fs-hub[data-fs]>.fs-body>.tl{height:100%;border-radius:0;box-shadow:none}
.fs-hub[data-fs]>.fs-body>.tl .tl-scroll{max-height:none;height:100%}
.smap-tl .fs-open{top:0;left:2px}
.sm-empty{position:absolute;inset:0;z-index:650;display:grid;place-items:center;pointer-events:none}
.smap-list{display:flex;flex-direction:column;gap:var(--section-gap)}
.sm-scroll{display:flex;flex-direction:column;gap:20px}
.sm-row[aria-pressed=true],.sm-row[aria-current=true]{background:color-mix(in srgb,var(--accent) var(--tint-a),transparent)}
.sm-swatch{flex:none;width:4px;align-self:stretch;border-radius:2px;background:var(--c)}
.sm-sumrow{margin:0 -8px;width:calc(100% + 16px)}
.sm-chipdot{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none}
.sm-when{flex:none;min-width:58px;padding:3px 7px;border-radius:8px;font:700 12px/16px system-ui,sans-serif;font-variant-numeric:tabular-nums;text-align:center;background:color-mix(in srgb,var(--c,var(--sys-gray)) 16%,transparent);color:var(--label)}
.sm-when[data-un]{background:none;box-shadow:inset 0 0 0 1.5px var(--sys-gray);border:0;color:var(--label-2)}
@container (min-width:640px){
.smap-grid{display:grid;gap:var(--sm-gap);grid-template-columns:minmax(0,1fr);grid-template-rows:auto min(62dvh,640px) auto;grid-template-areas:"bar" "map" "tl"}
.smap[data-panel] .smap-grid{grid-template-columns:var(--sm-left) minmax(0,1fr);grid-template-areas:"bar bar" "left map" "left tl"}
.smap-bar{grid-area:bar}
.smap-left{grid-area:left;display:block;position:relative;min-height:0}
.smap:not([data-panel]) .smap-left{display:none}
.smap-left>.sm-scroll,.smap-right>.sm-scroll{position:absolute;inset:0;overflow:auto;overscroll-behavior:contain}
.smap-map{grid-area:map;height:auto;min-height:0;margin:0;border-radius:var(--radius-card);box-shadow:var(--shadow-card)}
.smap-tl{grid-area:tl;min-width:0}
.smap-chips,.smap-list{display:none}
.smap-panel-btn{display:inline-flex}
.smap-right{grid-area:map;display:block;position:relative;z-index:600;justify-self:end;width:min(344px,calc(100% - 24px));margin:12px;border-radius:var(--radius-card);background:var(--card);box-shadow:var(--shadow-float);transform:translateX(28px);opacity:0;visibility:hidden;transition:transform var(--dur-snappy) var(--ease-spring),opacity var(--dur-quick) var(--ease-out),visibility 0s linear var(--dur-snappy)}
.smap-right>.sm-scroll{padding:16px}
.smap[data-sel] .smap-right{transform:none;opacity:1;visibility:visible;transition:transform var(--dur-snappy) var(--ease-spring),opacity var(--dur-quick) var(--ease-out)}
}
@container (min-width:1060px){
.smap-grid,.smap[data-panel] .smap-grid{grid-template-columns:var(--sm-left) minmax(0,1fr) var(--sm-right);grid-template-rows:auto minmax(0,1fr) auto;grid-template-areas:"bar map right" "left map right" "tl tl right";height:calc(100dvh - var(--sm-top,206px));min-height:560px}
.smap-left,.smap:not([data-panel]) .smap-left{display:block}
.smap-panel-btn{display:none}
.smap-right{grid-area:right;justify-self:stretch;width:auto;margin:0;z-index:auto;background:none;box-shadow:none;border-radius:0;transform:none;opacity:1;visibility:visible;transition:none}
.smap-right>.sm-scroll{padding:0 2px 8px}
}
.sm-date:has(:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
@container (min-width:1060px){.sm-card{padding:20px;border-radius:var(--radius-card);background:var(--card);box-shadow:var(--shadow-card)}}
.sm-in{animation:sm-in var(--dur-snappy) var(--ease-spring)}
@keyframes sm-in{from{transform:translateX(20px);opacity:.6}}
.tl{--tl-label:118px;--tl-hour:56px;position:relative;border-radius:var(--radius-card);background:var(--card);box-shadow:var(--shadow-card);overflow:hidden}
.tl-scroll{overflow-x:auto;overscroll-behavior-x:contain;max-height:220px;overflow-y:auto}
.tl-inner{position:relative;min-width:calc(var(--tl-label) + var(--hours) * var(--tl-hour))}
.tl-head,.tl-row{display:grid;grid-template-columns:var(--tl-label) minmax(0,1fr)}
.tl-head{position:sticky;top:0;z-index:7;background:var(--card);border-bottom:1px solid var(--sep)}
.tl-ticks{position:relative;height:36px}
.tl-tick{position:absolute;top:11px;padding-left:4px;font:600 11px/14px system-ui,sans-serif;color:var(--label-2);font-variant-numeric:tabular-nums}
.tl-label{position:sticky;left:0;z-index:6;display:flex;align-items:center;gap:7px;min-width:0;padding:0 8px 0 10px;background:var(--card);border-right:1px solid var(--sep);font:600 12px/16px system-ui,sans-serif}
.tl-label>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tl-row+.tl-row{border-top:1px solid var(--sep)}
.tl-row[data-fade] .tl-track,.tl-row[data-fade] .tl-label{opacity:.35}
.tl-track{position:relative;min-height:30px;background-image:linear-gradient(to right,var(--sep) 1px,transparent 1px);background-size:calc(100% / var(--hours)) 100%}
.tl-bar{position:absolute;height:22px;padding:0 5px;border-radius:7px;background:color-mix(in srgb,var(--c) 18%,var(--card));box-shadow:inset 0 0 0 1.5px var(--c);color:var(--label);font:700 11px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;cursor:pointer;transition:transform var(--dur-quick) var(--ease-spring-snappy),box-shadow var(--dur-quick) var(--ease-out)}
.tl-gap{position:absolute;height:22px;display:flex;align-items:center;justify-content:center;container-type:inline-size;pointer-events:none}
.tl-gap::before{content:"";position:absolute;left:3px;right:3px;top:50%;border-top:1.5px dashed color-mix(in srgb,var(--c) 60%,transparent)}
.tl-mi{position:relative;display:none;padding:0 5px;border-radius:999px;background:var(--card);color:var(--label-2);font:600 10px/14px system-ui,sans-serif;font-variant-numeric:tabular-nums;box-shadow:0 0 0 1px var(--sep);white-space:nowrap}
@container (min-width:46px){.tl-mi{display:inline}}
.tl-row[data-fade] .tl-gap{opacity:.35}
.tl-in{container-type:inline-size;display:flex;align-items:center;gap:4px;width:100%;height:100%;overflow:hidden;white-space:nowrap}
.tl-full{display:none}
.tl-dot{flex:none;width:6px;height:6px;border-radius:50%}
.tl-pop{position:absolute;left:0;top:0;z-index:5;padding:3px 7px;border-radius:7px;background:var(--label);color:var(--bg);font:600 11px/14px system-ui,sans-serif;white-space:nowrap;pointer-events:none;box-shadow:var(--shadow-raised)}
.tl-pop[hidden]{display:none}
.tl[data-size=lg] .tl-pop{padding:5px 9px;font-size:13px;line-height:16px}
.tl-bar:hover,.tl-bar[data-hover],.tl-bar:focus-visible{transform:translateY(-1px);box-shadow:inset 0 0 0 2px var(--c),0 2px 8px rgb(0 0 0/.18);z-index:4}
.tl-bar[aria-pressed=true]{box-shadow:inset 0 0 0 2px var(--c),0 0 0 2px var(--label);z-index:2}
.tl-bar[data-st~=done]{background:var(--fill-2);color:var(--label-2)}
.tl-bar[data-st~=late]{box-shadow:inset 0 0 0 2px var(--sys-red)}
.tl-bar[data-st~=un]{background:var(--card);box-shadow:none;outline:1.5px dashed var(--sys-gray);outline-offset:-1.5px;color:var(--label-2)}
.tl-late{flex:none;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;background:var(--sys-red);color:#fff;font:800 9px/1 system-ui,sans-serif}
.tl-now{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--sys-red);pointer-events:none;z-index:2}
.tl-now::before{content:"";position:absolute;top:0;left:-3px;width:8px;height:8px;border-radius:50%;background:var(--sys-red)}
@container (min-width:1060px){.tl{--tl-label:112px;--tl-hour:0px}}
.tl-n2{display:none}
.tl[data-size=lg]{--tl-label:100px}
.tl[data-size=lg] .tl-label{gap:8px;padding:0 8px 0 10px;font-size:14px}
.tl[data-size=lg] .tl-label .sm-chipdot{display:none}
@media (orientation:landscape) and (min-width:600px){.tl[data-size=lg]{--tl-label:176px}.tl[data-size=lg] .tl-n1{display:none}.tl[data-size=lg] .tl-n2{display:inline}}
.tl[data-size=lg] .tl-inner{display:flex;flex-direction:column;min-height:100%}
.tl[data-size=lg] .tl-row{flex:1 0 auto}
.tl[data-size=lg] .tl-bar{padding:0;border-radius:10px;overflow:clip}
.tl-card{position:relative;z-index:1;display:flex;flex-direction:column;justify-content:center;gap:2px;width:max-content;max-width:100%;height:100%;padding:0 8px;overflow:hidden;border-radius:9px}
.tl-card[data-pinned]{z-index:2;max-width:none}
.tl-card[data-clip]{-webkit-mask-image:linear-gradient(to right,#000 calc(var(--fade-at) - 14px),transparent var(--fade-at));mask-image:linear-gradient(to right,#000 calc(var(--fade-at) - 14px),transparent var(--fade-at))}
.tl-l1{display:flex;align-items:center;gap:5px;font-size:13px;line-height:16px;font-weight:700;white-space:nowrap}
.tl-l2{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:15px;font-weight:500;color:var(--label-2)}
@media (prefers-reduced-motion:reduce){.sm-in{animation:fade-in 150ms linear}.smap-right,.smap[data-sel] .smap-right{transition:opacity 150ms linear,visibility 0s}.tl-bar{transition:none}}${fits()}`;
