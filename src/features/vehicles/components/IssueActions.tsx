"use client";

import { Check, Wrench } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { updateVehicleIssue } from "../actions";

type IssueStatus = "open" | "acknowledged" | "in_repair" | "resolved";

const load = () => import("./ResolveIssueSheet");
const ResolveIssueSheet = dynamic(load, { ssr: false });
const preload = () => void load();

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
  const [armed, setArmed] = useState(false);
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
      <Button
        size="sm"
        variant="tinted"
        onPointerEnter={preload}
        onPointerDown={preload}
        onFocus={preload}
        onClick={() => {
          setArmed(true);
          setOpen(true);
        }}
      >
        Resolve
      </Button>
      {armed && (
        <ResolveIssueSheet
          open={open}
          onOpenChange={setOpen}
          pending={pending}
          error={error}
          resolution={resolution}
          onResolution={(v) => {
            setResolution(v);
            setError(undefined);
          }}
          onResolve={() => set("resolved", resolution)}
        />
      )}
    </div>
  );
}
