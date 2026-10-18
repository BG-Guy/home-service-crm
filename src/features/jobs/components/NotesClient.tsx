"use client";

import { Eye, Pin, PinOff, Trash2 } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { useDraft } from "@/client/drafts";
import { useOutboxState } from "@/client/outbox";
import { formatRelative } from "@/lib/time";
import { useConfirm } from "@/ui/components/Alert";
import { Avatar } from "@/ui/components/Avatar";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Pill } from "@/ui/components/StatusPill";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { TextLink } from "@/ui/components/TextLink";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import { haptic } from "@/ui/motion/haptics";
import { deleteNote, setNotePinned } from "../actions";
import type { NoteView } from "../queries";
import { newClientId, runOffline } from "./offline-client";
import { ROW_SEP } from "./sep";
import { atOrBefore, useNow } from "./use-now";

// S5 client body: add-note form (offline through the outbox, autosaved draft),
// pinned-first list, pin/unpin and delete for the author or an editor.

type Local = NoteView & { queued?: boolean };

export function NotesClient({
  entity,
  notes,
  viewerId,
  canEditAll,
  allowCustomerVisible,
  renderedAt,
  authorHrefs = {},
}: {
  entity: { type: "job" | "customer" | "lead"; id: string };
  notes: NoteView[];
  viewerId: string;
  canEditAll: boolean;
  allowCustomerVisible: boolean;
  /** Server render time (ms): relative times match on hydration (QA T1-13). */
  renderedAt: number;
  /** Where each author's name leads (by user id), computed on the server. */
  authorHrefs?: Record<string, string>;
}) {
  const [now] = useNow(renderedAt);
  const key = `note:${entity.type}:${entity.id}`;
  const [body, setBody, clearBody] = useDraft(key, "");
  const [visible, setVisible] = useState(false);
  const [queued, setQueued] = useState<Local[]>([]);
  const [optimistic, apply] = useOptimistic(
    notes as Local[],
    (cur, patch: { id: string; pinned?: boolean; deleted?: boolean }) =>
      patch.deleted
        ? cur.filter((n) => n.id !== patch.id)
        : cur.map((n) =>
            n.id === patch.id ? { ...n, pinned: patch.pinned ?? n.pinned } : n,
          ),
  );
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const outbox = useOutboxState();

  const list = [
    ...queued.filter((q) => !notes.some((n) => n.id === q.id)),
    ...optimistic,
  ];

  const add = () =>
    start(async () => {
      const text = body.trim();
      if (!text) return;
      const clientId = newClientId();
      const r = await runOffline<{ noteId: string }>("jobs.addNote", {
        entityType: entity.type,
        entityId: entity.id,
        body: text,
        visibility: visible ? "customer" : "internal",
        clientId,
      });
      if (!r.queued && r.result && !r.result.ok) {
        toast.error(r.result.error);
        return;
      }
      haptic();
      clearBody();
      setBody("");
      setVisible(false);
      if (r.queued) {
        setQueued((q) => [
          {
            id: clientId,
            body: text,
            visibility: visible ? "customer" : "internal",
            pinned: false,
            authorId: viewerId,
            authorName: "You",
            createdAt: new Date().toISOString(),
            queued: true,
          },
          ...q,
        ]);
        toast({
          title: "Note saved on this phone",
          message: "It syncs when you're back online.",
        });
      }
    });

  const pin = (n: Local) =>
    start(async () => {
      apply({ id: n.id, pinned: !n.pinned });
      const r = await setNotePinned({ noteId: n.id, pinned: !n.pinned });
      if (!r.ok) toast.error(r.error);
    });

  const remove = async (n: Local) => {
    const ok = await confirm({
      title: "Delete this note?",
      message: "It's removed from the timeline. The audit log keeps a record.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      apply({ id: n.id, deleted: true });
      const r = await deleteNote({ noteId: n.id });
      if (!r.ok) toast.error(r.error);
      else toast.success("Note deleted");
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b-[0.5px] border-[var(--sep)] px-4 py-3">
        <TextArea
          label="Add a note"
          hideLabel
          placeholder="Add a note…"
          rows={2}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          {allowCustomerVisible ? (
            <div className="flex min-h-11 items-center gap-2 text-subhead text-label-2">
              <Toggle
                label="Visible to the customer"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
              />
              <span aria-hidden>Customer can see it</span>
            </div>
          ) : (
            <span className="text-footnote text-label-3">Internal note</span>
          )}
          <Button
            size="sm"
            loading={pending && !!body.trim()}
            disabled={!body.trim()}
            onClick={add}
          >
            Add note
          </Button>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="list-row px-4 py-3 text-subhead text-label-2">
          No notes yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {list.map((n) => {
            const editable =
              !n.queued && (n.authorId === viewerId || canEditAll);
            const authorHref =
              !n.queued && n.authorId ? authorHrefs[n.authorId] : undefined;
            const row = (
              <div className="list-row flex gap-3 bg-card px-4 py-3">
                <Avatar
                  name={n.authorName ?? "Someone"}
                  seed={n.authorId ?? n.id}
                  size={28}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-footnote text-label-2">
                    {authorHref ? (
                      <TextLink href={authorHref} className="font-semibold">
                        {n.authorName ?? "Someone"}
                      </TextLink>
                    ) : (
                      <span className="font-semibold text-label">
                        {n.authorName ?? "Someone"}
                      </span>
                    )}
                    <span>
                      · {formatRelative(atOrBefore(n.createdAt, now), now)}
                    </span>
                    {n.pinned && (
                      <Pill tone="orange" size="sm" dot={false}>
                        Pinned
                      </Pill>
                    )}
                    {n.visibility === "customer" && (
                      <Pill tone="blue" size="sm" dot={false}>
                        <Eye size={11} aria-hidden className="mr-0.5 inline" />
                        Customer
                      </Pill>
                    )}
                    {n.queued && (
                      <Pill tone="gray" size="sm">
                        {outbox.online ? "Syncing…" : "Waiting to sync"}
                      </Pill>
                    )}
                  </div>
                  <p
                    className={cx(
                      "mt-0.5 whitespace-pre-wrap break-words text-body",
                      n.queued && "text-label-2",
                    )}
                  >
                    {n.body}
                  </p>
                </div>
                {editable && (
                  <div className="hidden shrink-0 items-start gap-1 lg:flex">
                    <button
                      type="button"
                      onClick={() => pin(n)}
                      aria-label={n.pinned ? "Unpin note" : "Pin note"}
                      className="flex size-9 items-center justify-center rounded-full text-label-2 hover:bg-fill"
                    >
                      {n.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(n)}
                      aria-label="Delete note"
                      className="flex size-9 items-center justify-center rounded-full text-[var(--sys-red)] hover:bg-fill"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            );
            return (
              <li key={n.id} className={ROW_SEP}>
                {editable ? (
                  <SwipeActions
                    leading={[
                      {
                        label: n.pinned ? "Unpin" : "Pin",
                        icon: n.pinned ? (
                          <PinOff size={18} />
                        ) : (
                          <Pin size={18} />
                        ),
                        tone: "orange",
                        onAction: () => pin(n),
                      },
                    ]}
                    trailing={[
                      {
                        label: "Delete",
                        icon: <Trash2 size={18} />,
                        destructive: true,
                        onAction: () => void remove(n),
                      },
                    ]}
                  >
                    {row}
                  </SwipeActions>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}
      {confirmEl}
    </div>
  );
}
