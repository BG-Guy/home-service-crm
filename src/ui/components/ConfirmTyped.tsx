"use client";

import { type ReactNode, useId, useState } from "react";
import { Alert } from "./Alert";

/**
 * Type-to-confirm for bulk / dangerous actions (SPEC §12.6). The destructive
 * button enables only when the typed text matches `phrase` (case-insensitive).
 * `onConfirm` may be async; the alert stays open with a pending label until it
 * settles, and closes on success.
 */
export function ConfirmTyped({
  open,
  onOpenChange,
  title,
  message,
  phrase,
  confirmLabel = "Delete",
  pendingLabel = "Working…",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  message?: ReactNode;
  /** What the user must type, e.g. "DELETE" or the record name. */
  phrase: string;
  confirmLabel?: string;
  pendingLabel?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = text.trim().toLowerCase() === phrase.trim().toLowerCase();

  const change = (o: boolean) => {
    if (busy) return;
    if (!o) setText("");
    onOpenChange(o);
  };

  return (
    <Alert
      open={open}
      onOpenChange={change}
      title={title}
      message={message}
      actions={[
        { label: "Cancel", style: "cancel", disabled: busy },
        {
          label: busy ? pendingLabel : confirmLabel,
          style: "destructive",
          disabled: !matches || busy,
          keepOpen: true,
          onPress: async () => {
            setBusy(true);
            try {
              await onConfirm();
              setText("");
              onOpenChange(false);
            } finally {
              setBusy(false);
            }
          },
        },
      ]}
    >
      <label
        htmlFor={id}
        className="mb-2 block text-center text-footnote text-label-2"
      >
        Type <span className="font-semibold text-label">{phrase}</span> to
        confirm.
      </label>
      <input
        id={id}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={busy}
        className="h-11 w-full rounded-[12px] bg-card px-3 text-body outline-none shadow-[inset_0_0_0_0.5px_var(--sep)] transition-shadow duration-150 focus:shadow-[inset_0_0_0_2px_var(--accent)]"
      />
    </Alert>
  );
}
