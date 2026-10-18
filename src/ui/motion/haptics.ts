// Haptics (SPEC §12.2). Android: navigator.vibrate(10). iOS has no vibrate API;
// the optional hack toggles a hidden `<input type=checkbox switch>` (Safari 17.4+
// plays the system switch haptic). The hack is off unless the integrator enables it
// from `settings.ui.haptics_hack` via `setHapticsHack(true)`.

let iosHack = false;
let hackLabel: HTMLLabelElement | null = null;

export function setHapticsHack(enabled: boolean): void {
  iosHack = enabled;
}

function ensureHackLabel(): HTMLLabelElement | null {
  if (hackLabel?.isConnected) return hackLabel;
  if (typeof document === "undefined") return null;
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText =
    "position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9px;top:0";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  hackLabel = label;
  return label;
}

/** A light tap. Call from a user-gesture handler (toggle, success, long-press). */
export function haptic(): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(10);
    } catch {
      /* ignore */
    }
    return;
  }
  if (iosHack) ensureHackLabel()?.click();
}
