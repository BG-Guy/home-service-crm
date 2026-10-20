"use client";

import {
  Camera,
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
import { formatMoney } from "@/lib/money";
import type { ActionSheetItem } from "@/ui/components/ActionSheet";
import { BarSummary } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { preloadable } from "@/ui/components/preloadable";
import { toast } from "@/ui/components/Toast";
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

// Status-aware job dock (SPEC M06 table, BUILD_PLAN §5.3 "Tech action bar →
// producers"), styled as the kit's booking bar (DESIGN.md §5 BottomBar): tool
// tiles on top, then a summary on the left and the one primary on the right.
// Phone: sticky at the bottom of DetailLayout (above the tab bar). Desktop
// (>= 1200): the first card of the sticky right rail. Every transition runs
// through the offline outbox with a geostamp; requirements open the
// Start/Complete sheet. Sheets, the photo sheet, the signature sheet and the
// More menu are lazy chunks loaded on first open, so the dock itself stays small.

// The photo sheet and the next step's sheet are warmed on idle (below) and render
// at once on tap: `preloadable` skips the Suspense round trip that would hold a
// warmed sheet back by React's 300 ms reveal throttle.
const EtaSheet = preloadable(() =>
  import("./sheets/EtaSheet").then((m) => m.default),
);
const RequirementsSheet = preloadable(() =>
  import("./sheets/RequirementsSheet").then((m) => m.default),
);
const HoldSheet = dynamic(() => import("./sheets/HoldSheet"), { ssr: false });
const VisitSheet = dynamic(() => import("./sheets/VisitSheet"), { ssr: false });
const CancelSheet = dynamic(() => import("./sheets/CancelSheet"), {
  ssr: false,
});
const ActionSheet = dynamic(
  () => import("@/ui/components/ActionSheet").then((m) => m.ActionSheet),
  { ssr: false },
);
const CameraCaptureButton = preloadable(() =>
  import("@/features/media/components/capture").then(
    (m) => m.CameraCaptureButton,
  ),
);
const SignatureSheet = dynamic(
  () =>
    import("@/features/signatures/slots.client").then((m) => m.SignatureSheet),
  { ssr: false },
);
const warmCamera = () => void CameraCaptureButton.preload().catch(() => {});

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
  /** Bar summary context, formatted in the company time zone by the page. */
  summary?: {
    /** "Today · 11:00 AM – 1:00 PM". */
    window: string | null;
    /** "ETA 2:35 PM". */
    eta: string | null;
    /** Hold reason label. */
    hold: string | null;
    /** Invoice balance (completed jobs). */
    balanceCents: number | null;
  };
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
  "pressable relative flex h-[52px] min-w-0 flex-1 basis-0 select-none flex-col items-center justify-center gap-0.5 rounded-[14px] bg-fill-2 px-1 text-caption font-semibold text-label outline-offset-2 hover:bg-fill [&>svg]:text-accent-text";
// Slot buttons (kit <Button>s from other modules) restyled as the same tile.
const SLOT_TILE =
  "flex min-w-0 flex-1 basis-0 [&>button]:h-[52px] [&>button]:w-full [&>button]:flex-col [&>button]:gap-0.5 [&>button]:rounded-[14px] [&>button]:bg-fill-2 [&>button]:px-1 [&>button]:text-caption [&>button]:text-label [&>button>span:first-child]:ml-0";

/**
 * The dock's Photos tile: a plain button; the photo sheet (tag control, camera,
 * library, upload pipeline) loads on first tap and is warmed on hover / touch.
 */
function PhotosTile({
  jobId,
  defaultTag,
  allowedTags,
}: {
  jobId: string;
  defaultTag: "before" | "after" | "during";
  allowedTags: ("before" | "during" | "after" | "problem")[] | undefined;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [taken, setTaken] = useState(0);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={taken ? `Photos, ${taken} added` : "Photos"}
        className={TILE}
        onPointerEnter={warmCamera}
        onTouchStart={warmCamera}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <span aria-hidden className="relative flex text-accent-text">
          <Camera size={18} />
          {taken > 0 && (
            <span className="badge-pop absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-fill px-1 text-[10px] font-bold leading-none text-on-accent tabular-nums">
              {taken}
            </span>
          )}
        </span>
        <span className="max-w-full truncate">Photos</span>
      </button>
      {mounted && (
        <CameraCaptureButton
          compact
          hideTrigger
          open={open}
          onOpenChange={setOpen}
          jobId={jobId}
          defaultTag={defaultTag}
          allowedTags={allowedTags}
          sheetTitle="Job photos"
          multiple
          onQueued={() => setTaken((n) => n + 1)}
        />
      )}
    </>
  );
}

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

  const afterArrival = isAfterArrival({ status, arrivedAt: job.arrivedAt });
  const canCancel =
    status !== "completed" &&
    status !== "closed" &&
    status !== "cancelled" &&
    (afterArrival ? p.perms.cancelAfterArrival : p.perms.cancel);
  const close = () => setSheet(null);
  // The More menu loads on first open and stays mounted for its close animation.
  // Once the page is idle, warm the chunks this status is likely to need next
  // (the photo sheet and the next step's sheet), so the first tap opens at
  // once without putting them in the page's first load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per status
  useEffect(() => {
    const warm = () => {
      if (p.perms.photos) warmCamera();
      if (status === "scheduled" || status === "confirmed")
        void EtaSheet.preload().catch(() => {});
      if (status === "arrived" || status === "in_progress")
        void RequirementsSheet.preload().catch(() => {});
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warm, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(t);
  }, [status]);
  const [moreMounted, setMoreMounted] = useState(false);
  useEffect(() => {
    if (sheet === "more") setMoreMounted(true);
  }, [sheet]);

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
      <PhotosTile
        key="cam"
        jobId={job.id}
        defaultTag={tag}
        allowedTags={jobTags}
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
        icon={<Play size={20} aria-hidden />}
        loading={pending === "in_progress"}
        onClick={startJob}
      >
        Start job
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
        icon={<CircleCheck size={20} aria-hidden />}
        loading={pending === "completed"}
        onClick={() => setSheet("complete")}
      >
        Complete
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
        icon={<Clock size={20} aria-hidden />}
        loading={pending === "scheduled"}
        onClick={() => setSheet("visit")}
      >
        Return visit
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
          className="contents"
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
          href={`/jobs/${p.nextJobId}`}
          transition="push"
          icon={<StepForward size={20} aria-hidden />}
        >
          Next job
        </Button>
      ) : (
        <Button size="lg" variant="tinted" href="/today" transition="back">
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

  // ------------------------------------------------------------ bar summary
  const sum = p.summary;
  const todo = (n: number, what: string) =>
    n ? `${n} to do before you ${what}` : null;
  let summary: { title: ReactNode; subtitle?: ReactNode } = {
    title: job.number,
  };
  if (status === "scheduled" || status === "confirmed")
    summary = {
      title: sum?.window ?? "Not scheduled",
      subtitle: status === "confirmed" ? "Confirmed by customer" : "Scheduled",
    };
  else if (status === "en_route")
    summary = { title: "On the way", subtitle: sum?.eta ?? sum?.window };
  else if (status === "arrived")
    summary = {
      title: startMissing.length
        ? `${startMissing.length} to do`
        : "Ready to start",
      subtitle: todo(startMissing.length, "start") ?? "You're on site",
    };
  else if (status === "in_progress")
    summary = {
      title: completeMissing.length
        ? `${completeMissing.length} to do`
        : p.invoice?.lines.length
          ? formatMoney(p.invoice.totalCents)
          : "In progress",
      subtitle: completeMissing.length
        ? "Before you complete"
        : p.invoice?.lines.length
          ? "Job total so far"
          : "Ready to complete",
    };
  else if (status === "on_hold")
    summary = { title: "On hold", subtitle: sum?.hold ?? undefined };
  else if (status === "completed") {
    const owed = sum?.balanceCents ?? null;
    const unpaid =
      job.paymentStatus !== "paid" && job.paymentStatus !== "refunded";
    summary =
      unpaid && owed != null && owed > 0
        ? { title: formatMoney(owed), subtitle: "Balance due" }
        : { title: "Job complete", subtitle: unpaid ? "Not paid yet" : "Paid" };
  }

  // Phone: tell fixed overlays (sync capsule, toasts) the dock's real height;
  // the kit's 84 px default assumes a bar without the tile row. In the
  // desktop rail the dock is a plain card, so nothing lifts (0).
  const dockRef = useRef<HTMLElement>(null);
  const hasDock = primary != null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the dock mounts
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const root = document.documentElement;
    const wide = window.matchMedia("(min-width: 1200px)");
    const publish = () =>
      root.style.setProperty(
        "--bottombar-h",
        wide.matches && el.closest(".detail-rail")
          ? "0px"
          : `${el.offsetHeight + 20}px`,
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    wide.addEventListener("change", publish);
    return () => {
      ro.disconnect();
      wide.removeEventListener("change", publish);
      root.style.removeProperty("--bottombar-h");
    };
  }, [hasDock]);

  if (!primary) return null;

  return (
    <>
      <section
        ref={dockRef}
        aria-label={`${job.number} actions`}
        data-chrome
        className="bottom-bar flex flex-col print:hidden"
      >
        {tools.length > 0 && (
          <div
            role="toolbar"
            aria-label="Job tools"
            className="grid auto-cols-fr grid-flow-col gap-2 px-2.5 pt-2.5 min-[1200px]:order-1 min-[1200px]:px-4 min-[1200px]:pt-0 min-[1200px]:pb-4"
          >
            {tools}
          </div>
        )}
        <div className="bottom-bar-in">
          <div className="bottom-bar-summary">
            <BarSummary title={summary.title} subtitle={summary.subtitle} />
          </div>
          <div
            aria-busy={busy || undefined}
            className="bottom-bar-actions max-w-[60%] min-[1200px]:w-full min-[1200px]:max-w-none min-[1200px]:[&>*]:flex-1 [&_button]:max-w-full"
          >
            {primary}
          </div>
        </div>
      </section>

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
      {(sheet === "more" || moreMounted) && (
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
      )}
    </>
  );
}
