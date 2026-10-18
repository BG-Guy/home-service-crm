"use client";

import { Share, Smartphone, SquarePlus } from "lucide-react";
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
import { Banner } from "./Banner";
import { Button } from "./Button";
import { ListRow } from "./List";
import { Sheet } from "./Sheet";

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
 * - `variant="auto"` (default): a dismissible banner that appears on Chromium
 *   when installable, or on iOS Safari after the 2nd visit; "How" opens the
 *   instructions sheet.
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
      setSheet(true);
    }
  };

  const instructions = (
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
      <Banner
        tone="info"
        icon={<Smartphone size={20} aria-hidden />}
        title={`Install ${appName}`}
        onDismiss={() => {
          dismissInstallHint();
          setHint(null);
        }}
        action={
          <Button size="sm" variant="tinted" onClick={install}>
            {hint === "prompt" ? "Install" : "Show me how"}
          </Button>
        }
      >
        Add it to your Home Screen for a full-screen app with notifications.
      </Banner>
      {instructions}
    </>
  );
}

export default InstallPrompt;
