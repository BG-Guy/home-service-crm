// The inbox's view state shared by its header row (the 1/2 switch), the grid and
// the map (plain module of client hooks; InboxView provides it).
import { createContext, useContext } from "react";
import type { InboxShow, LeadCols } from "./inbox-prefs";

export interface InboxViewState {
  /** Phone columns (the cookie); wider screens fit as many as there's room for. */
  cols: LeadCols;
  setCols(c: LeadCols): void;
  /** Phones and tablets: the grid or the map. Desktop shows both. */
  show: InboxShow;
  setShow(s: InboxShow): void;
}

export const InboxViewContext = createContext<InboxViewState | null>(null);

export function useInboxView(): InboxViewState {
  const v = useContext(InboxViewContext);
  if (!v) throw new Error("useInboxView must be used inside <InboxView>");
  return v;
}
