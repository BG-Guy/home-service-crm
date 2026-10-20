"use client";

import { Check, Copy, MessageSquare } from "lucide-react";

import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";

export interface SentInvite {
  url: string;
  expiresAt: string;
  emailed: boolean;
  texted: boolean;
  smsHref: string | null;
  name: string;
}

/** The "invite ready" card: copy or text the join link. */
export function InviteSent({ sent }: { sent: SentInvite }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(sent.url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.");
    }
  }
  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex flex-col items-center gap-2 px-4 pt-4 text-center">
        <span
          aria-hidden
          className="flex size-14 items-center justify-center rounded-full bg-[var(--sys-green)] text-white enter-pop"
        >
          <Check size={30} strokeWidth={3} />
        </span>
        <h3 className="text-title3 font-semibold">{sent.name} is invited</h3>
        <p className="text-subhead text-label-2">
          {sent.emailed && "We emailed the link. "}
          {sent.texted && "A text is waiting in your outbox. "}
          The link expires{" "}
          {new Date(sent.expiresAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
          .
        </p>
      </div>
      <section>
        <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
          Invite link
        </h2>
        <div className="flex flex-col gap-3 rounded-card bg-card p-4">
          <code className="select-all break-all rounded-lg bg-fill-3 px-3 py-2 text-footnote">
            {sent.url}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="tinted"
              size="sm"
              icon={
                copied ? (
                  <Check aria-hidden size={16} />
                ) : (
                  <Copy aria-hidden size={16} />
                )
              }
              onClick={copy}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            {sent.smsHref && (
              <Button
                variant="gray"
                size="sm"
                href={sent.smsHref}
                transition="none"
                icon={<MessageSquare aria-hidden size={16} />}
              >
                Text it now
              </Button>
            )}
          </div>
        </div>
        <p className="px-4 pt-1.5 text-footnote text-label-2">
          Anyone with this link can join, so share it only with {sent.name}.
        </p>
      </section>
    </div>
  );
}
