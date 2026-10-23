// Shared client context for the lead UI (leads-flow redesign, contract 3.4).
// A plain module (hooks + contexts): only client components import it.
//
//   LeadEnvContext  who is looking and what they may do, plus `notify` (a toast,
//                   or the card's own Undo bar inside the sheet) and `changed`.
//   LeadCardContext the lead card: `useLeadCard().open(id)` from a box, a map pin
//                   or anywhere under <LeadCardProvider>.
import { createContext, useContext } from "react";
import type { LeadBoxData } from "../contracts";

export interface LeadNotice {
  title: string;
  message?: string;
  tone?: "default" | "success" | "error" | "warning";
  /** Shows "Undo" for a few seconds. */
  undo?: () => void;
}

/** The serializable part, built by the server page. */
export interface LeadEnvInit {
  viewerId: string;
  can: { edit: boolean; convert: boolean; viewCustomers: boolean };
  lostReasons: string[];
  /** Raster tile template for the mini map ("" when no street map is set up). */
  tileUrl: string;
}

export interface LeadEnv extends LeadEnvInit {
  notify(n: LeadNotice): void;
  /** After a change: reload the open card (pages refresh on their own). */
  changed(leadId: string): void;
}

export const LeadEnvContext = createContext<LeadEnv | null>(null);

export function useLeadEnv(): LeadEnv {
  const v = useContext(LeadEnvContext);
  if (!v) throw new Error("useLeadEnv must be used inside a lead provider");
  return v;
}

export interface LeadCardApi {
  /** Open the lead card (bottom sheet on phones, centered sheet on wider screens). */
  open(leadId: string): void;
  close(): void;
  /** Warm the card's data and code (hover, pointer down). */
  prefetch(leadId: string): void;
  /** Boxes a view shows, so a card opens with its TL;DR at once (grid, map drawer). */
  seed(items: readonly LeadBoxData[]): void;
  /** The lead whose card is open. */
  openId: string | null;
  /** Every box seeded so far (map pins). */
  boxes: readonly LeadBoxData[];
}

export const LeadCardContext = createContext<LeadCardApi | null>(null);

/** Contract 3.4: `useLeadCard()` → `{ open(leadId), close() }` (+ prefetch, seed). */
export function useLeadCard(): LeadCardApi {
  const v = useContext(LeadCardContext);
  if (!v) throw new Error("useLeadCard must be used inside <LeadCardProvider>");
  return v;
}

/** The card API when there is one (a box outside the inbox has none). */
export function useLeadCardMaybe(): LeadCardApi | null {
  return useContext(LeadCardContext);
}
