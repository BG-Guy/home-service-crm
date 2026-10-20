"use client";

import { Share, Smartphone, SquarePlus, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  canPromptInstall,
  dismissInstallHint,
  initInstallPrompt,
  installHint,
  isIos,
  isStandalone,
  onInstallAvailabilityChange,
  promptInstall,
} from "@/client/install-prompt";
import { Button } from "./Button";

// Loaded only when used: the shell mounts this after idle, and most visits never
// open the instructions (Sheet) or show the More row (ListRow).
const Sheet = dynamic(() => import("./Sheet").then((m) => m.Sheet), {
  ssr: false,
});
const ListRow = dynamic(() => import("./List").then((m) => m.ListRow), {
  ssr: false,
});

function IosSteps() {
  const step = "flex items-center gap-3 py-2.5 text-body";
  const n =
    "flex size-7 shrink-0 items-center justify-center rounded-full bg-fill-2 text-subhead font-semibold";
  return (
    <ol className="list-card px-4 py-1">
      <li className={step}>
        <span className={n}>1</span>
        <span>
          Tap{" "}
          <Share
            aria-label="Share"
            size={18}
            className="inline -mt-1 text-accent-text"
          />{" "}
          <b>Share</b> in Safari's toolbar.
        </span>
      </li>
      <li className={`${step} hairline-t`}>
        <span className={n}>2</span>
        <span>
          Scroll and tap{" "}
          <SquarePlus aria-hidden size={18} className="inline -mt-1" />{" "}
          <b>Add to Home Screen</b>.
        </span>
      </li>
      <li className={`${step} hairline-t`}>
        <span className={n}>3</span>
        <span>
          Tap <b>Add</b>, then open the app from your Home Screen.
        </span>
      </li>
    </ol>
  );
}

/**
 * Install the PWA (SPEC §M01, §12.3).
 * - `variant="auto"` (default): a dismissible glass nudge floating above the tab
 *   bar (bottom-left on desktop) that appears on Chromium when installable, or on
 *   iOS Safari after the 2nd visit; "Show me how" opens the instructions sheet.
 *   It floats, so appearing late never shifts the page.
 * - `variant="row"`: an "Install app" list row for the More menu (hidden when
 *   already installed).
 * Load lazily (`LazyInstallPrompt`).
 */
export function InstallPrompt({
  variant = "auto",
  appName = "the app",
}: {
  variant?: "auto" | "row";
  appName?: string;
}) {
  const [hint, setHint] = useState<"ios" | "prompt" | null>(null);
  const [installed, setInstalled] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [sheetUsed, setSheetUsed] = useState(false);

  useEffect(() => {
    initInstallPrompt();
    setInstalled(isStandalone());
    if (variant === "auto") setHint(installHint());
    return onInstallAvailabilityChange(() => {
      setInstalled(isStandalone());
      if (variant === "auto") setHint(installHint());
    });
  }, [variant]);

  const install = async () => {
    if (canPromptInstall()) {
      const r = await promptInstall();
      if (r === "accepted") setHint(null);
    } else {
      setSheetUsed(true);
      setSheet(true);
    }
  };

  const instructions = sheetUsed && (
    <Sheet
      open={sheet}
      onOpenChange={setSheet}
      title="Add to Home Screen"
      detents={["content"]}
      trailing={
        <Button variant="plain" size="sm" onClick={() => setSheet(false)}>
          Done
        </Button>
      }
    >
      <p className="mb-4 text-subhead text-label-2">
        Install {appName} for full-screen use, faster start-up and
        notifications.
      </p>
      {isIos() ? (
        <IosSteps />
      ) : (
        <p className="text-body">
          Open your browser menu and choose <b>Install app</b> or{" "}
          <b>Add to Home screen</b>.
        </p>
      )}
    </Sheet>
  );

  if (variant === "row") {
    if (installed) return null;
    return (
      <>
        <ListRow
          icon={<Smartphone size={17} aria-hidden />}
          iconTone="gray"
          title="Install app"
          onClick={install}
          accessory="chevron"
        />
        {instructions}
      </>
    );
  }

  if (!hint) return instructions;
  return (
    <>
      <section
        aria-label={`Install ${appName}`}
        className="install-nudge glass-chrome enter-rise"
      >
        <span aria-hidden className="install-nudge-icon">
          <Smartphone size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-subhead font-semibold">
            Install {appName}
          </div>
          <div className="text-footnote text-label-2">
            Full screen, faster start, notifications.
          </div>
        </div>
        <Button size="sm" variant="tinted" onClick={install}>
          {hint === "prompt" ? "Install" : "Show me how"}
        </Button>
        <button
          type="button"
          aria-label="Not now"
          className="hit-44 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-label-2"
          onClick={() => {
            dismissInstallHint();
            setHint(null);
          }}
        >
          <X aria-hidden size={18} />
        </button>
      </section>
      {instructions}
    </>
  );
}

export default InstallPrompt;
