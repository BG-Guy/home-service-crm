"use client";

import { Bell, BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getPushSubscription,
  pushSupport,
  subscribePush,
  unsubscribePush,
} from "@/client/push";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { getPushConfig, sendTestNotification } from "../actions";

type State =
  | "loading"
  | "on"
  | "off"
  | "needs-install"
  | "unsupported"
  | "denied"
  | "unconfigured";

/** S36: subscribe to Web Push from a tap (iOS: only from the installed app). */
export function PushButton({
  label = "Turn on notifications",
}: {
  label?: string;
}) {
  const [state, setState] = useState<State>("loading");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canSetUp, setCanSetUp] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sup = pushSupport();
      if (!sup.ok) {
        if (alive)
          setState(
            sup.reason === "needs-install" ? "needs-install" : sup.reason,
          );
        return;
      }
      const res = await getPushConfig({});
      const k = res.ok ? (res.data?.vapidPublicKey ?? null) : null;
      if (!alive) return;
      setKey(k);
      setCanSetUp(res.ok ? !!res.data?.canSetUp : false);
      if (!k) {
        setState("unconfigured");
        return;
      }
      setState((await getPushSubscription()) ? "on" : "off");
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") return null;
  if (state === "needs-install")
    return (
      <p className="text-footnote text-label-2">
        To get notifications on iPhone, add this app to your Home Screen first
        (Share → Add to Home Screen), then open it from there.
      </p>
    );
  if (state === "unsupported")
    return (
      <p className="text-footnote text-label-2">
        This browser can&apos;t show notifications. You&apos;ll still see them
        in the bell.
      </p>
    );
  if (state === "denied")
    return (
      <p className="text-footnote text-label-2">
        Notifications are blocked for this app. Allow them in your device
        settings, then come back.
      </p>
    );
  if (state === "unconfigured")
    return (
      <p className="text-footnote text-label-2">
        {canSetUp
          ? "Phone notifications aren't set up yet. Turn them on in Settings → Integrations."
          : "Phone notifications aren't available yet. You'll still see everything in the bell."}
      </p>
    );
  if (state === "on")
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="gray"
          size="sm"
          icon={<BellRing aria-hidden size={16} />}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const res = await sendTestNotification({});
            setBusy(false);
            toast(
              res.ok
                ? {
                    title: "Test sent",
                    message: "It should arrive in a few seconds.",
                  }
                : { title: "Couldn't send", message: res.error, tone: "error" },
            );
          }}
        >
          Send a test
        </Button>
        <Button
          variant="plain"
          size="sm"
          onClick={async () => {
            await unsubscribePush();
            setState("off");
            toast({ title: "Notifications off on this device" });
          }}
        >
          Turn off on this device
        </Button>
      </div>
    );
  return (
    <Button
      variant="filled"
      icon={<Bell aria-hidden size={18} />}
      loading={busy}
      onClick={async () => {
        if (!key) return;
        setBusy(true);
        const res = await subscribePush(key);
        setBusy(false);
        if (res.ok) {
          setState("on");
          toast({ title: "Notifications on", tone: "success" });
        } else if (res.error === "denied") setState("denied");
        else
          toast({
            title: "Couldn't turn on",
            message: res.error,
            tone: "error",
          });
      }}
    >
      {label}
    </Button>
  );
}
