"use client";

import { Check, Wrench } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { updateVehicleIssue } from "../actions";

type IssueStatus = "open" | "acknowledged" | "in_repair" | "resolved";

/** Admin controls on an issue: acknowledge → in repair → resolve (with resolution). */
export function IssueActions({
  issueId,
  status,
}: {
  issueId: string;
  status: IssueStatus;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState<string | undefined>();

  const set = (next: IssueStatus, res?: string) =>
    start(async () => {
      const r = await updateVehicleIssue({
        issueId,
        status: next,
        resolution: res ?? null,
      });
      if (!r.ok) {
        setError(r.fieldErrors?.resolution?.[0] ?? r.error);
        if (!r.fieldErrors) toast({ title: r.error, tone: "error" });
        return;
      }
      setOpen(false);
      setResolution("");
      toast({
        title:
          next === "resolved"
            ? "Issue resolved"
            : next === "in_repair"
              ? "Marked in repair"
              : next === "open"
                ? "Issue reopened"
                : "Issue acknowledged",
        tone: "success",
      });
    });

  if (status === "resolved")
    return (
      <Button
        variant="plain"
        size="sm"
        loading={pending}
        onClick={() => set("open")}
      >
        Reopen
      </Button>
    );

  return (
    <div className="flex flex-wrap gap-2">
      {status === "open" && (
        <Button
          size="sm"
          icon={<Check size={16} aria-hidden />}
          loading={pending}
          onClick={() => set("acknowledged")}
        >
          Acknowledge
        </Button>
      )}
      {status !== "in_repair" && (
        <Button
          size="sm"
          variant="gray"
          icon={<Wrench size={16} aria-hidden />}
          loading={pending}
          onClick={() => set("in_repair")}
        >
          In repair
        </Button>
      )}
      <Button size="sm" variant="tinted" onClick={() => setOpen(true)}>
        Resolve
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Resolve issue"
        detents={["medium"]}
        dirty={resolution !== ""}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
        footer={
          <Button
            size="lg"
            fullWidth
            loading={pending}
            onClick={() => set("resolved", resolution)}
          >
            Mark resolved
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-4 pt-1">
          <TextArea
            label="How was it fixed?"
            placeholder="Replaced O2 sensor at Valley Auto; light cleared."
            value={resolution}
            onChange={(e) => {
              setResolution(e.currentTarget.value);
              setError(undefined);
            }}
            error={error}
            rows={4}
          />
        </div>
      </Sheet>
    </div>
  );
}
