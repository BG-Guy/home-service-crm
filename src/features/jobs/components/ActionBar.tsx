"use client";

import {
  Car,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Ellipsis,
  FileText,
  MapPinCheck,
  MessageCircle,
  Navigation,
  NotebookPen,
  Phone,
  Play,
  Receipt,
  StepForward,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useOutboxState } from "@/client/outbox";
import { CameraCaptureButton } from "@/features/media/slots.client";
import { SignatureSheet } from "@/features/signatures/slots.client";
import { formatMoney } from "@/lib/money";
import { ActionSheet, type ActionSheetItem } from "@/ui/components/ActionSheet";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { haptic } from "@/ui/motion/haptics";
import {
  logJobCall,
  requestStartApproval,
  signJobCompletion,
} from "../actions";
import type { JobStatus } from "../contracts";
import {
  type CancellationPolicy,
  type GuardMiss,
  isAfterArrival,
} from "../machine";
import { useStatusRunner } from "./sheets/use-status";

// Sticky, status-aware action bar for the job screen (SPEC M06 table, BUILD_PLAN
// §5.3 "Tech action bar → producers"). Every transition runs through the offline
// outbox with a geostamp; requirements open the Start/Complete sheet. Sheets are
// lazy chunks so the bar itself stays small.

const EtaSheet = dynamic(() => import("./sheets/EtaSheet"), { ssr: false });
const RequirementsSheet = dynamic(() => import("./sheets/RequirementsSheet"), {
  ssr: false,
});
const HoldSheet = dynamic(() => import("./sheets/HoldSheet"), { ssr: false });
const VisitSheet = dynamic(() => import("./sheets/VisitSheet"), { ssr: false });
const CancelSheet = dynamic(() => import("./sheets/CancelSheet"), {
  ssr: false,
});

export interface ActionBarProps {
  job: {
    id: string;
    number: string;
    status: JobStatus;
    customerName: string;
    customerFirstName: string | null;
    windowStart: string | null;
    arrivedAt: string | null;
    paymentStatus: string;
  };
  navUrl: string | null;
  phone: string | null;
  perms: {
    field: boolean;
    cancel: boolean;
    cancelAfterArrival: boolean;
    reviewCancellations: boolean;
    override: boolean;
    photos: boolean;
    estimates: boolean;
  };
  startMissing: GuardMiss[] | null;
  completeMissing: GuardMiss[] | null;
  windowLengths: number[];
  defaultWindow: number;
  todayKey: string;
  policy: CancellationPolicy;
  esignText: string;
  nextJobId: string | null;
  beforeAfter: boolean;
  /** The job has a checklist (the in-progress Checklist tile links to it). */
  hasChecklist?: boolean;
  /** A completion signature is already on file. */
  signed?: boolean;
  /** Draft invoice lines (in progress): the sign-off summary and the empty-invoice warning. */
  invoice?: { lines: string[]; totalCents: number } | null;
  /** Job photos by tag (in progress): the "recommended photos" row. */
  photoCounts?: { before: number; after: number; total: number } | null;
  /** Deep link `?action=complete` opens the Complete sheet. */
  initialSheet?: "complete" | null;
  slots: {
    readiness?: ReactNode;
    collect?: ReactNode;
    collectDeposit?: ReactNode;
    addPart?: ReactNode;
    orderPart?: ReactNode;
  };
}

type Sheet =
  | null
  | "eta"
  | "late"
  | "start"
  | "complete"
  | "hold"
  | "visit"
  | "cancel"
  | "more";

// Dock tools are equal-width tiles (icon over label, like the action buttons on an
// iOS contact card): up to four always fit at 320 px, so nothing hides off-screen
// (QA T4-01). Secondary actions live under More. The row is a grid of equal
// columns: in a flex row a tile's own padding counted toward its basis, so the
// unpadded slot wrappers came out 8 px narrower (QA2 NEW-10).
const TILE =
  "pressable relative flex h-12 min-w-0 flex-1 basis-0 select-none flex-col items-center justify-center gap-0.5 rounded-[14px] bg-fill-2 px-1 text-caption font-semibold text-accent-text outline-offset-2 hover:bg-fill";
// Slot buttons (kit <Button>s from other modules) restyled as the same tile.
const SLOT_TILE =
  "flex min-w-0 flex-1 basis-0 [&>button]:h-12 [&>button]:w-full [&>button]:flex-col [&>button]:gap-0.5 [&>button]:rounded-[14px] [&>button]:px-1 [&>button]:text-caption [&>button>span:first-child]:ml-0";

function Tool({
  icon,
  label,
  onClick,
  href,
  external,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  external?: boolean;
}) {
  const body = (
    <>
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </>
  );
  if (href && external)
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={TILE}
        onClick={onClick}
      >
        {body}
      </a>
    );
  if (href)
    return (
      <Link href={href} className={TILE} onClick={onClick}>
        {body}
      </Link>
    );
  return (
    <button type="button" className={TILE} onClick={onClick}>
      {body}
    </button>
  );
}

export function ActionBar(p: ActionBarProps) {
  const { job } = p;
  const [status, setStatus] = useState<JobStatus>(job.status);
  useEffect(() => setStatus(job.status), [job.status]);
  const [sheet, setSheet] = useState<Sheet>(
    p.initialSheet === "complete" && job.status === "in_progress"
      ? "complete"
      : null,
  );
  const [startMissing, setStartMissing] = useState<GuardMiss[]>(
    p.startMissing ?? [],
  );
  const [completeMissing, setCompleteMissing] = useState<GuardMiss[]>(
    p.completeMissing ?? [],
  );
  useEffect(() => setStartMissing(p.startMissing ?? []), [p.startMissing]);
  useEffect(
    () => setCompleteMissing(p.completeMissing ?? []),
    [p.completeMissing],
  );
  const { run, pending } = useStatusRunner(job.id, (to) => setStatus(to));
  const [approving, startApproving] = useTransition();
  const outbox = useOutboxState();
  const bannerUp =
    !outbox.online ||
    (outbox.syncing && outbox.pending > 0) ||
    outbox.uploading > 0 ||
    (outbox.pending > 0 && !!outbox.lastError);

  const afterArrival = isAfterArrival({ status, arrivedAt: job.arrivedAt });
  const canCancel =
    status !== "completed" &&
    status !== "closed" &&
    status !== "cancelled" &&
    (afterArrival ? p.perms.cancelAfterArrival : p.perms.cancel);
  const close = () => setSheet(null);

  const call = () => {
    if (!p.phone) {
      toast({
        title: "Number hidden",
        message: "Customer contact shows during the job window.",
      });
      return;
    }
    void logJobCall({ jobId: job.id, outcome: "connected" });
    window.location.href = `tel:${p.phone}`;
  };

  const doRun = async (
    to: JobStatus,
    extra: Record<string, unknown>,
    success: string,
    onBlocked?: (m: GuardMiss[]) => void,
  ) => {
    haptic();
    const r = await run(to, extra, { geo: true, success });
    if (r === null) return;
    if (r === "queued") {
      close();
      return;
    }
    if (r.status === "blocked") {
      onBlocked?.(r.missing);
      return;
    }
    setStatus(r.to);
    close();
  };

  const startJob = () => {
    if (startMissing.length) {
      setSheet("start");
      return;
    }
    void doRun("in_progress", {}, "Job started", (m) => {
      setStartMissing(m);
      setSheet("start");
    });
  };

  const askApproval = () =>
    startApproving(async () => {
      const r = await requestStartApproval({ jobId: job.id });
      if (!r.ok) toast.error(r.error);
      else if (r.data?.status === "approved")
        toast.success("Already approved — you can start.");
      else
        toast.success("Approval requested", {
          message: "You'll get a notification when an admin decides.",
        });
    });

  const jobTags: ("before" | "during" | "after" | "problem")[] | undefined =
    p.beforeAfter ? ["before", "during", "after", "problem"] : undefined;
  /**
   * Full capture control (inside the Start/Complete sheet). Only the tags its
   * requirement counts (before to start; before + after to finish), so the tag
   * control fits at 390 px (QA2 NEW-15). The dock's Photos tile has every tag.
   */
  const camera = (
    tag: "before" | "after" | "during",
    label: string,
    tags: ("before" | "during" | "after" | "problem")[] | undefined,
  ) =>
    p.perms.photos ? (
      <CameraCaptureButton
        key={tag}
        jobId={job.id}
        defaultTag={tag}
        allowedTags={tags}
        label={label}
        multiple
      />
    ) : null;
  /** One dock tile that opens the photo sheet (tag control + camera + library). */
  const cameraTile = (tag: "before" | "after" | "during") =>
    p.perms.photos ? (
      <CameraCaptureButton
        key="cam"
        compact
        triggerClassName={TILE}
        jobId={job.id}
        defaultTag={tag}
        allowedTags={jobTags}
        label="Photos"
        sheetTitle="Job photos"
        multiple
      />
    ) : null;

  const [signed, setSigned] = useState(!!p.signed);
  useEffect(() => setSigned(!!p.signed), [p.signed]);
  const signature = (
    <SignatureSheet
      title="Customer sign-off"
      docType="completion"
      consentText={p.esignText}
      summaryLines={[
        `${job.number} — work completed`,
        job.customerName,
        ...(p.invoice?.lines ?? []),
        ...(p.invoice?.lines.length
          ? [`Total ${formatMoney(p.invoice.totalCents)}`]
          : []),
      ]}
      signerNameDefault={job.customerName}
      action={signJobCompletion.bind(null, job.id)}
      triggerLabel={signed ? "Sign again" : "Get signature"}
      triggerVariant={signed ? "gray" : "filled"}
      size="md"
      onSigned={() => setSigned(true)}
    />
  );

  // A paid-in-full collection refreshes the page, which flips the primary button
  // from Collect to Next job. Keep the collect slot (and its Done / receipt view)
  // mounted until its sheet closes (QA T1-07). The Sheet unmounts its <dialog>
  // right after close(), so the native `close` event never reaches us: watch the
  // slot for its dialog instead, and let go once none is open (QA2 NEW-1).
  const collectRef = useRef<HTMLDivElement>(null);
  const [collectHold, setCollectHold] = useState(false);
  useEffect(() => {
    const el = collectRef.current;
    if (!collectHold) return;
    if (!el) {
      setCollectHold(false);
      return;
    }
    let seen = false;
    const check = () => {
      if (el.querySelector("dialog[open]")) seen = true;
      else if (seen) setCollectHold(false);
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    // The tap didn't open a sheet (e.g. it missed the button): don't hold.
    const t = window.setTimeout(() => {
      if (!seen) setCollectHold(false);
    }, 1500);
    return () => {
      mo.disconnect();
      window.clearTimeout(t);
    };
  }, [collectHold]);

  // ---------------------------------------------------------- per-status content
  let primary: ReactNode = null;
  const tools: ReactNode[] = [];
  const more: ActionSheetItem[] = [];
  const busy = pending != null;

  if (status === "scheduled" || status === "confirmed") {
    primary = (
      <Button
        size="lg"
        fullWidth
        icon={<Car size={20} aria-hidden />}
        loading={pending === "en_route"}
        onClick={() => setSheet("eta")}
      >
        On my way
      </Button>
    );
    tools.push(
      <Tool
        key="call"
        icon={<Phone size={18} aria-hidden />}
        label="Call"
        onClick={call}
      />,
      <Tool
        key="text"
        icon={<MessageCircle size={18} aria-hidden />}
        label="Text"
        href={`/jobs/${job.id}?tab=messages`}
      />,
    );
    if (p.navUrl)
      tools.push(
        <Tool
          key="nav"
          icon={<Navigation size={18} aria-hidden />}
          label="Navigate"
          href={p.navUrl}
          external
        />,
      );
    more.push(
      {
        label: "I'm already here (Arrived)",
        onSelect: () => void doRun("arrived", {}, "Arrived"),
      },
      { label: "Running late", onSelect: () => setSheet("late") },
    );
  } else if (status === "en_route") {
    primary = (
      <Button
        size="lg"
        fullWidth
        icon={<MapPinCheck size={20} aria-hidden />}
        loading={pending === "arrived"}
        onClick={() => void doRun("arrived", {}, "Arrived")}
      >
        Arrived
      </Button>
    );
    tools.push(
      <Tool
        key="late"
        icon={<Clock size={18} aria-hidden />}
        label="Running late"
        onClick={() => setSheet("late")}
      />,
    );
    if (p.navUrl)
      tools.push(
        <Tool
          key="nav"
          icon={<Navigation size={18} aria-hidden />}
          label="Navigate"
          href={p.navUrl}
          external
        />,
      );
    tools.push(
      <Tool
        key="call"
        icon={<Phone size={18} aria-hidden />}
        label="Call"
        onClick={call}
      />,
    );
  } else if (status === "arrived") {
    primary = (
      <Button
        size="lg"
        fullWidth
        icon={<Play size={20} aria-hidden />}
        loading={pending === "in_progress"}
        onClick={startJob}
      >
        Start job{startMissing.length ? ` · ${startMissing.length} to do` : ""}
      </Button>
    );
    const cam = cameraTile("before");
    if (cam) tools.push(cam);
    if (p.perms.estimates)
      tools.push(
        <Tool
          key="est"
          icon={<FileText size={18} aria-hidden />}
          label="Estimate"
          href={`/estimates/new?jobId=${job.id}`}
        />,
      );
    tools.push(
      <Tool
        key="call"
        icon={<Phone size={18} aria-hidden />}
        label="Call"
        onClick={call}
      />,
    );
    more.push({ label: "Put on hold", onSelect: () => setSheet("hold") });
  } else if (status === "in_progress") {
    primary = (
      <Button
        size="lg"
        fullWidth
        icon={<CircleCheck size={20} aria-hidden />}
        loading={pending === "completed"}
        onClick={() => setSheet("complete")}
      >
        Complete
        {completeMissing.length ? ` · ${completeMissing.length} to do` : ""}
      </Button>
    );
    const cam = cameraTile(p.beforeAfter ? "after" : "during");
    if (cam) tools.push(cam);
    if (p.slots.addPart)
      tools.push(
        <span key="part" className={SLOT_TILE}>
          {p.slots.addPart}
        </span>,
      );
    tools.push(
      p.hasChecklist ? (
        <Tool
          key="check"
          icon={<ClipboardCheck size={18} aria-hidden />}
          label="Checklist"
          href={`/jobs/${job.id}?tab=overview#checklist`}
        />
      ) : (
        <Tool
          key="notes"
          icon={<NotebookPen size={18} aria-hidden />}
          label="Notes"
          href={`/jobs/${job.id}?tab=overview#notes`}
        />
      ),
    );
    more.push(
      ...(p.perms.estimates
        ? [
            {
              label: "Estimate or change order",
              href: `/jobs/${job.id}?tab=estimate`,
            },
          ]
        : []),
      ...(p.hasChecklist
        ? [{ label: "Notes", href: `/jobs/${job.id}?tab=overview#notes` }]
        : []),
      { label: "Put on hold", onSelect: () => setSheet("hold") },
    );
  } else if (status === "on_hold") {
    primary = (
      <Button
        size="lg"
        fullWidth
        icon={<Clock size={20} aria-hidden />}
        loading={pending === "scheduled"}
        onClick={() => setSheet("visit")}
      >
        Schedule return visit
      </Button>
    );
    if (p.slots.orderPart)
      tools.push(
        <span key="order" className={SLOT_TILE}>
          {p.slots.orderPart}
        </span>,
      );
    const cam = cameraTile("during");
    if (cam) tools.push(cam);
    tools.push(
      <Tool
        key="notes"
        icon={<NotebookPen size={18} aria-hidden />}
        label="Notes"
        href={`/jobs/${job.id}?tab=overview#notes`}
      />,
    );
    more.push({
      label: "Resume work now",
      onSelect: () => void doRun("in_progress", {}, "Work resumed"),
    });
  } else if (status === "completed") {
    const unpaid =
      job.paymentStatus !== "paid" && job.paymentStatus !== "refunded";
    primary =
      (unpaid || collectHold) && p.slots.collect ? (
        <div
          ref={collectRef}
          className="[&>*]:w-full"
          onClickCapture={() => {
            // Only a tap that opens the sheet arms the hold; taps inside the
            // open sheet (Done) must not re-arm it after the job is paid.
            if (!collectRef.current?.querySelector("dialog[open]"))
              setCollectHold(true);
          }}
        >
          {p.slots.collect}
        </div>
      ) : p.nextJobId ? (
        <Button
          size="lg"
          fullWidth
          href={`/jobs/${p.nextJobId}`}
          transition="push"
          icon={<StepForward size={20} aria-hidden />}
        >
          Next job
        </Button>
      ) : (
        <Button
          size="lg"
          fullWidth
          variant="tinted"
          href="/today"
          transition="back"
        >
          Back to Today
        </Button>
      );
    tools.push(
      <Tool
        key="inv"
        icon={<Receipt size={18} aria-hidden />}
        label="Invoice"
        href={`/jobs/${job.id}?tab=invoice`}
      />,
    );
    if (unpaid && p.slots.collect && p.nextJobId)
      tools.push(
        <Tool
          key="next"
          icon={<StepForward size={18} aria-hidden />}
          label="Next job"
          href={`/jobs/${p.nextJobId}`}
        />,
      );
  }
  if (canCancel)
    more.push({
      label: "Cancel job",
      destructive: true,
      onSelect: () => setSheet("cancel"),
    });
  if (more.length)
    tools.push(
      <Tool
        key="more"
        icon={<Ellipsis size={18} aria-hidden />}
        label="More"
        onClick={() => setSheet("more")}
      />,
    );

  // Publish the dock's real height as --dock-h so the page pads exactly enough
  // to scroll its last rows clear of it (plus the offline banner when it's up).
  const dockRef = useRef<HTMLDivElement>(null);
  const hasDock = primary != null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the dock mounts (hasDock) or the banner offset changes
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const root = document.documentElement;
    const extra = bannerUp ? 48 : 0;
    const publish = () =>
      root.style.setProperty("--dock-h", `${el.offsetHeight + extra}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bannerUp, hasDock]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty("--dock-h");
    },
    [],
  );

  if (!primary) return null;

  return (
    <>
      <div
        data-chrome
        className={cx(
          "fixed inset-x-0 z-[var(--z-bar)] px-[var(--gutter)] transition-[bottom] duration-300 ease-[var(--ease-spring)] lg:left-[260px] print:hidden",
          bannerUp
            ? "bottom-[calc(var(--tabbar-space)+52px)] lg:bottom-[68px]"
            : "bottom-[calc(var(--tabbar-space)+4px)] lg:bottom-4",
        )}
      >
        <div
          ref={dockRef}
          role="toolbar"
          aria-label={`${job.number} actions`}
          className="enter-fade-up material mx-auto flex max-w-[560px] flex-col gap-2 rounded-[24px] p-2 shadow-[var(--shadow-float),0_0_0_0.5px_var(--sep)]"
        >
          {tools.length > 0 && (
            <div className="grid auto-cols-fr grid-flow-col gap-2">{tools}</div>
          )}
          <div aria-busy={busy || undefined}>{primary}</div>
        </div>
      </div>

      {(sheet === "eta" || sheet === "late") && (
        <EtaSheet
          open
          onOpenChange={(o) => !o && close()}
          mode={sheet === "eta" ? "on_my_way" : "late"}
          customerFirstName={job.customerFirstName}
          pending={busy}
          onSubmit={(eta) => {
            if (sheet === "eta")
              void doRun("en_route", { etaMinutes: eta }, "On the way");
            else
              void (async () => {
                const { runOffline } = await import("./offline-client");
                const r = await runOffline("jobs.runningLate", {
                  jobId: job.id,
                  etaMinutes: eta,
                });
                if (r.queued) toast("Saved — it will sync when you're online.");
                else if (r.result && !r.result.ok) toast.error(r.result.error);
                else toast.success(`New ETA: ${eta} min`);
                close();
              })();
          }}
        />
      )}
      {(sheet === "start" || sheet === "complete") && (
        <RequirementsSheet
          open
          onOpenChange={(o) => !o && close()}
          mode={sheet}
          jobId={job.id}
          missing={sheet === "start" ? startMissing : completeMissing}
          canOverride={p.perms.override}
          pending={busy}
          readinessSlot={p.slots.readiness}
          signatureNode={signature}
          signed={signed}
          cameraNode={
            sheet === "start"
              ? camera(
                  "before",
                  "Take photos",
                  p.beforeAfter ? ["before"] : undefined,
                )
              : camera(
                  "after",
                  "Take photos",
                  p.beforeAfter ? ["before", "after"] : undefined,
                )
          }
          collectNode={p.slots.collectDeposit}
          invoiceEmpty={
            sheet === "complete" &&
            p.invoice != null &&
            p.invoice.lines.length === 0
          }
          recommendPhotos={
            sheet === "complete" &&
            p.perms.photos &&
            p.photoCounts != null &&
            (p.beforeAfter
              ? p.photoCounts.before === 0 || p.photoCounts.after === 0
              : p.photoCounts.total === 0)
              ? p.beforeAfter
                ? "Before and after photos"
                : "Photos of the finished work"
              : null
          }
          onRequestApproval={askApproval}
          approvalPending={approving}
          onSubmit={(overrideReason) =>
            void doRun(
              sheet === "start" ? "in_progress" : "completed",
              overrideReason ? { overrideReason } : {},
              sheet === "start" ? "Job started" : "Job completed",
              (m) =>
                sheet === "start" ? setStartMissing(m) : setCompleteMissing(m),
            )
          }
        />
      )}
      {sheet === "hold" && (
        <HoldSheet
          open
          onOpenChange={(o) => !o && close()}
          pending={busy}
          onSubmit={(reason, note) =>
            void doRun("on_hold", { reason, note }, "Job on hold")
          }
        />
      )}
      {sheet === "visit" && (
        <VisitSheet
          open
          onOpenChange={(o) => !o && close()}
          title="Return visit"
          submitLabel="Schedule visit"
          defaultDate={p.todayKey}
          defaultMinutes={p.defaultWindow}
          windowLengths={p.windowLengths}
          pending={busy}
          onSubmit={(v) => void doRun("scheduled", v, "Return visit scheduled")}
        />
      )}
      {sheet === "cancel" && (
        <CancelSheet
          open
          onOpenChange={(o) => !o && close()}
          jobId={job.id}
          afterArrival={afterArrival}
          reviewNeeded={afterArrival && !p.perms.reviewCancellations}
          windowStart={job.windowStart}
          policy={p.policy}
          pending={busy}
          onSubmit={(v) => void doRun("cancelled", v, "Job cancelled")}
        />
      )}
      <ActionSheet
        open={sheet === "more"}
        onOpenChange={(o) => !o && close()}
        title={job.number}
        items={more.map((m) => ({
          ...m,
          onSelect: m.onSelect
            ? () => setTimeout(() => m.onSelect?.(), 0)
            : undefined,
        }))}
      />
    </>
  );
}
