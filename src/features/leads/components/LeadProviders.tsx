"use client";

import dynamic from "next/dynamic";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "@/ui/components/Toast";
import { loadLeadCard } from "../actions";
import type { LeadBoxData, LeadCardData } from "../contracts";
import { PendingCallPrompt } from "./CallOutcomeFlow";
import {
  type LeadCardApi,
  LeadCardContext,
  type LeadEnv,
  LeadEnvContext,
  type LeadEnvInit,
  type LeadNotice,
} from "./lead-env";

// The sheet (Sheet kit, card body, action groups) is one chunk, fetched on the
// first hover / press of a box and mounted on the first open.
const loadSheet = () => import("./LeadCardSheet");
const LeadCardSheet = dynamic(loadSheet, { ssr: false });

const toastNotify = (n: LeadNotice) =>
  void toast({
    title: n.title,
    message: n.message,
    tone: n.tone,
    undo: n.undo,
  });

const PARAM = "lead";
const FRESH_MS = 8000;

/**
 * Who is looking and what they may do, for lead UI outside the inbox (the
 * /leads/[id] page): notices are toasts, and the page refreshes itself after a
 * change. Also asks again for a call whose outcome was never logged.
 */
export function LeadEnvProvider({
  init,
  children,
}: {
  init: LeadEnvInit;
  children: ReactNode;
}) {
  const value = useMemo<LeadEnv>(
    () => ({ ...init, notify: toastNotify, changed: () => {} }),
    [init],
  );
  return (
    <LeadEnvContext.Provider value={value}>
      {children}
      <PendingCallPrompt />
    </LeadEnvContext.Provider>
  );
}

/**
 * The lead card (contract 3.4): `useLeadCard().open(id)` from a box or a map pin
 * slides the card up (a bottom sheet on phones, a centered sheet on wider
 * screens) with the box's TL;DR at once and the rest from the light loader
 * (`loadLeadCard`). `?lead=<id>` mirrors it, so Back closes it and a reload or a
 * link reopens it. Cards are cached per lead and reloaded after each change.
 */
export function LeadCardProvider({
  init,
  children,
}: {
  init: LeadEnvInit;
  children: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [cards, setCards] = useState<Record<string, LeadCardData>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [boxes, setBoxes] = useState<readonly LeadBoxData[]>([]);
  const seeds = useRef(new Map<string, LeadBoxData>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const loadedAt = useRef(new Map<string, number>());
  const pushed = useRef(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  /**
   * `fresh`: reuse a card loaded (or loading) in the last few seconds, so a press
   * that warmed it and the tap that opens it make one request. Server actions run
   * one at a time, so every load saved keeps Call / Undo quick.
   */
  const load = useCallback((id: string, mode: "cache" | "fresh" | "force") => {
    const running = inflight.current.get(id);
    if (running && mode !== "force") return running;
    const at = loadedAt.current.get(id) ?? 0;
    if (mode === "cache" && cardsRef.current[id]) return Promise.resolve();
    if (mode === "fresh" && Date.now() - at < FRESH_MS)
      return Promise.resolve();
    const p = loadLeadCard(id)
      .then((r) => {
        if (r.ok) {
          loadedAt.current.set(id, Date.now());
          setCards((c) => ({ ...c, [id]: r.data }));
          setErrors(({ [id]: _drop, ...rest }) => rest);
        } else setErrors((e) => ({ ...e, [id]: r.error }));
      })
      .catch(() =>
        setErrors((e) => ({ ...e, [id]: "Couldn't load this lead." })),
      )
      .finally(() => {
        if (inflight.current.get(id) === p) inflight.current.delete(id);
      });
    inflight.current.set(id, p);
    return p;
  }, []);

  const show = useCallback(
    (id: string, history: "push" | "replace" | "none") => {
      setArmed(true);
      setOpenId(id);
      setShownId(id);
      void load(id, "fresh");
      if (history === "none") return;
      const url = new URL(window.location.href);
      url.searchParams.set(PARAM, id);
      if (history === "push" && !pushed.current) {
        window.history.pushState(null, "", url);
        pushed.current = true;
      } else window.history.replaceState(null, "", url);
    },
    [load],
  );

  const open = useCallback(
    (id: string) => show(id, pushed.current ? "replace" : "push"),
    [show],
  );

  const close = useCallback(() => {
    setOpenId(null);
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      const url = new URL(window.location.href);
      if (url.searchParams.has(PARAM)) {
        url.searchParams.delete(PARAM);
        window.history.replaceState(null, "", url);
      }
    }
  }, []);

  // Back / forward and links with ?lead=<id> (a reload, a pin, a notification).
  useEffect(() => {
    const sync = () => {
      const id = new URL(window.location.href).searchParams.get(PARAM);
      if (id && /^[0-9a-f-]{36}$/i.test(id)) {
        if (id !== openId) show(id, "none");
      } else if (openId) {
        pushed.current = false;
        setOpenId(null);
      }
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [openId, show]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get(PARAM);
    if (id && /^[0-9a-f-]{36}$/i.test(id)) show(id, "none");
  }, []);

  const prefetch = useCallback(
    (id: string) => {
      void loadSheet();
      void load(id, "cache");
    },
    [load],
  );

  const seed = useCallback((items: readonly LeadBoxData[]) => {
    let changed = false;
    for (const b of items) {
      if (seeds.current.get(b.id) !== b) {
        seeds.current.set(b.id, b);
        changed = true;
      }
    }
    if (changed) setBoxes([...seeds.current.values()]);
  }, []);

  const env = useMemo<LeadEnv>(
    () => ({
      ...init,
      notify: toastNotify,
      changed: (id: string) => {
        if (cardsRef.current[id] || inflight.current.has(id))
          void load(id, "force");
      },
    }),
    [init, load],
  );

  const api = useMemo<LeadCardApi>(
    () => ({ open, close, prefetch, seed, openId, boxes }),
    [open, close, prefetch, seed, openId, boxes],
  );

  // The box first (an instant TL;DR), the full card once it's loaded.
  const id = openId ?? shownId;
  const full = id ? cards[id] : undefined;
  const lead = full ?? (id ? seeds.current.get(id) : undefined) ?? null;

  return (
    <LeadEnvContext.Provider value={env}>
      <LeadCardContext.Provider value={api}>
        {children}
        {armed && (
          <LeadCardSheet
            open={!!openId}
            lead={lead}
            loading={!full}
            error={id ? (errors[id] ?? null) : null}
            onClose={close}
            onRetry={() => id && void load(id, "force")}
          />
        )}
        <PendingCallPrompt />
      </LeadCardContext.Provider>
    </LeadEnvContext.Provider>
  );
}
