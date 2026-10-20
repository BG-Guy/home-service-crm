"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";

/** Password reset link sheet (loaded on first open from MemberControls). */
export default function ResetSheet({
  name,
  link,
  onCreate,
  onClosed,
}: {
  name: string;
  link: { url: string; expiresAt: string; emailed: boolean } | null;
  onCreate: (email: boolean) => void;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClosed}
      title="Reset password"
      detents={["content"]}
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          onClick={() => setOpen(false)}
        >
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-6">
        {!link ? (
          <>
            <p className="px-4 text-subhead text-label-2">
              A single-use link lets {name.split(" ")[0]} choose a new password.
              It expires in 30 minutes. Their current password keeps working
              until they use it.
            </p>
            <div className="flex flex-col gap-2 px-4">
              <Button fullWidth onClick={() => onCreate(true)}>
                Email the link
              </Button>
              <Button variant="gray" fullWidth onClick={() => onCreate(false)}>
                Create a link to share
              </Button>
            </div>
          </>
        ) : (
          <section className="px-0">
            <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
              {link.emailed
                ? "Emailed — you can also share"
                : "Share this link"}
            </h2>
            <div className="flex flex-col gap-3 rounded-card bg-card p-4">
              <code className="select-all break-all rounded-lg bg-fill-3 px-3 py-2 text-footnote">
                {link.url}
              </code>
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
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link.url);
                    setCopied(true);
                    toast.success("Link copied");
                  } catch {
                    toast.error("Couldn't copy. Select the link instead.");
                  }
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
            <p className="px-4 pt-1.5 text-footnote text-label-2">
              Expires{" "}
              {new Date(link.expiresAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
              . Share it only with {name.split(" ")[0]}.
            </p>
          </section>
        )}
      </div>
    </Sheet>
  );
}
