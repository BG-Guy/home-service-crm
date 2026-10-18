"use client";

import { Camera, ScanLine, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { registerOfflineActions } from "@/client/offline-registry";
import { queueAction } from "@/client/outbox";
import type { ActionResult } from "@/lib/types";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { DateField } from "@/ui/components/DatePicker";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import {
  assignKit,
  checkInTool,
  checkOutTools,
  decideToolIncident,
  saveKit,
  scheduleAudit,
  setToolStatus,
} from "../actions";
import type { PickTool } from "../contracts";
import { offlineActions } from "../offline";
import { toolIdFromScan } from "../rules";
import { CONDITION_SEGMENTS, newId } from "./util";

// Lazy chunk with every tools sheet (loaded on first tap of any tools button).

type Condition = "new" | "good" | "fair" | "poor";
type Opt = { id: string; name: string };

let registered = false;
function offline<T>(
  key: string,
  input: Record<string, unknown> & { clientId: string },
) {
  if (!registered) {
    registerOfflineActions(offlineActions);
    registered = true;
  }
  return queueAction(key, {
    ...input,
    clientTs: new Date().toISOString(),
  }).then((r) => ({
    queued: r.queued,
    result: r.result as ActionResult<T> | undefined,
  }));
}

function Footer({
  pending,
  label,
  onClick,
  disabled,
  destructive,
}: {
  pending: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Button
      size="lg"
      fullWidth
      loading={pending}
      disabled={disabled}
      onClick={onClick}
      variant={destructive ? "destructive" : "filled"}
    >
      {label}
    </Button>
  );
}

function Cancel({ close }: { close: () => void }) {
  return (
    <Button variant="plain" size="sm" onClick={close}>
      Cancel
    </Button>
  );
}

function HandoffPhoto({
  entityId,
  onMedia,
  label = "Photo at handoff",
  required,
}: {
  entityId: string;
  onMedia: (id: string) => void;
  label?: string;
  required: boolean;
}) {
  const [n, setN] = useState(0);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-subhead font-semibold">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      <CameraButton
        kind="photo"
        tag="tool"
        entity={{ type: "tool", id: entityId }}
        label={n ? `Retake (${n})` : "Take photo"}
        variant="tinted"
        showLibrary
        onUploaded={(r) => {
          setN((x) => x + 1);
          onMedia(r.mediaId);
        }}
        onError={(e) =>
          toast({ title: "Photo failed", message: e.message, tone: "error" })
        }
      />
    </div>
  );
}

// ------------------------------------------------------------------ check out

/** Scan QR labels with BarcodeDetector when available (no zxing in base). */
function useScanner(onCode: (v: string) => void) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const supported =
    typeof window !== "undefined" && "BarcodeDetector" in window;
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const Detector = (
          window as unknown as {
            BarcodeDetector: new (o: {
              formats: string[];
            }) => {
              detect(s: HTMLVideoElement): Promise<{ rawValue: string }[]>;
            };
          }
        ).BarcodeDetector;
        const det = new Detector({ formats: ["qr_code"] });
        const loop = async () => {
          if (stop || !video.current) return;
          try {
            const codes = await det.detect(video.current);
            for (const c of codes) onCode(c.rawValue);
          } catch {
            /* frame not ready */
          }
          raf = window.setTimeout(loop, 350) as unknown as number;
        };
        void loop();
      } catch {
        toast({
          title: "Camera unavailable",
          message: "Pick the tools from the list instead.",
          tone: "warning",
        });
        setOn(false);
      }
    })();
    return () => {
      stop = true;
      clearTimeout(raf);
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, [on, onCode]);
  return { video, on, setOn, supported };
}

export function CheckOutSheet({
  open,
  onOpenChange,
  tools,
  preselected,
  users,
  vehicles,
  requirePhoto,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tools: PickTool[];
  preselected: string[];
  users: Opt[];
  vehicles: Opt[];
  requirePhoto: boolean;
}) {
  const [picked, setPicked] = useState<string[]>(preselected);
  const [q, setQ] = useState("");
  const [userId, setUserId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [condition, setCondition] = useState<Condition>("good");
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [anchor] = useState(() => preselected[0] ?? newId());
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools]);
  const onCode = useMemo(
    () => (v: string) => {
      const id = toolIdFromScan(v);
      const t = id ? byId.get(id) : undefined;
      if (!t) return;
      if (t.blocked) {
        toast({ title: `${t.name}: ${t.blocked}`, tone: "warning" });
        return;
      }
      setPicked((p) => {
        if (p.includes(t.id)) return p;
        navigator.vibrate?.(30);
        toast({ title: `Added ${t.name}`, tone: "success", duration: 1500 });
        return [...p, t.id];
      });
    },
    [byId],
  );
  const scan = useScanner(onCode);
  const list = tools.filter(
    (t) =>
      !q ||
      `${t.name} ${t.serial ?? ""} ${t.assetTag ?? ""}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const submit = () =>
    start(async () => {
      const r = await checkOutTools({
        toolIds: picked,
        userId: userId || null,
        vehicleId: vehicleId || null,
        condition,
        mediaId,
      });
      if (!r.ok) {
        toast({
          title: Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error,
          tone: "error",
        });
        return;
      }
      toast({
        title: `Checked out ${r.data?.count ?? picked.length}`,
        tone: "success",
      });
      onOpenChange(false);
      setPicked([]);
    });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Check out"
      detents={["large"]}
      desktop="panel"
      leading={<Cancel close={() => onOpenChange(false)} />}
      footer={
        <Footer
          pending={pending}
          label={`Check out ${picked.length || ""}`.trim()}
          disabled={
            !picked.length ||
            (!userId && !vehicleId) ||
            (requirePhoto && !mediaId)
          }
          onClick={submit}
        />
      }
    >
      <div className="flex flex-col gap-4 pb-4 pt-1">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="To tech"
            value={userId}
            placeholder="—"
            options={users.map((u) => ({ value: u.id, label: u.name }))}
            onChange={(e) => setUserId(e.currentTarget.value)}
          />
          <Select
            label="To vehicle"
            value={vehicleId}
            placeholder="—"
            options={vehicles.map((u) => ({ value: u.id, label: u.name }))}
            onChange={(e) => setVehicleId(e.currentTarget.value)}
          />
        </div>
        <SegmentedControl
          label="Condition at handoff"
          value={condition}
          segments={CONDITION_SEGMENTS}
          onChange={setCondition}
        />
        <HandoffPhoto
          entityId={anchor}
          onMedia={setMediaId}
          required={requirePhoto}
        />
        <div className="flex items-center gap-2">
          <TextField
            label="Find tools"
            hideLabel
            className="flex-1"
            placeholder="Name, serial or tag"
            value={q}
            leading={<Search size={16} aria-hidden />}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
          {scan.supported && (
            <Button
              variant={scan.on ? "filled" : "gray"}
              icon={<ScanLine size={18} aria-hidden />}
              onClick={() => scan.setOn(!scan.on)}
            >
              {scan.on ? "Stop" : "Scan"}
            </Button>
          )}
        </div>
        {scan.on && (
          <video
            ref={scan.video}
            playsInline
            muted
            className="aspect-video w-full rounded-card bg-black object-cover"
          />
        )}
        <ul
          className="list-card max-h-[40dvh] overflow-y-auto"
          aria-label="Tools"
        >
          {list.map((t) => {
            const on = picked.includes(t.id);
            return (
              <li key={t.id} className="list-row">
                <label
                  className={cx(
                    "flex min-h-11 items-center gap-3 px-4 py-2.5",
                    t.blocked && "opacity-50",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--accent)]"
                    checked={on}
                    disabled={!!t.blocked}
                    onChange={() => toggle(t.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{t.name}</span>
                    <span className="block truncate text-footnote text-label-2">
                      {t.blocked ??
                        [
                          t.assetTag,
                          t.serial,
                          t.holderName ? `with ${t.holderName}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ check in / repair

export function HandoffSheet({
  open,
  onOpenChange,
  toolId,
  mode,
  requirePhoto,
  leaveTo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  toolId: string;
  mode: "check_in" | "from_repair";
  requirePhoto: boolean;
  /** Where to go after a check-in that ends the viewer's access to this tool. */
  leaveTo?: string;
}) {
  const router = useRouter();
  const [condition, setCondition] = useState<Condition>("good");
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [toRepair, setToRepair] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const needPhoto = mode === "from_repair" || requirePhoto;
  const submit = () =>
    start(async () => {
      const r =
        mode === "check_in"
          ? await checkInTool({ toolId, condition, mediaId, toRepair, note })
          : await setToolStatus({
              toolId,
              status: "available",
              condition,
              mediaId,
            });
      if (!r.ok) {
        toast({
          title: Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error,
          tone: "error",
        });
        return;
      }
      toast({
        title: mode === "check_in" ? "Checked in" : "Back in service",
        tone: "success",
      });
      onOpenChange(false);
      // A tech who checks in their own tool is no longer its custodian, so the
      // detail page is no longer theirs: go back to their list (QA2 NEW-3).
      if (mode === "check_in" && leaveTo) router.replace(leaveTo);
    });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "check_in" ? "Check in" : "Return from repair"}
      detents={["large"]}
      leading={<Cancel close={() => onOpenChange(false)} />}
      footer={
        <Footer
          pending={pending}
          label={mode === "check_in" ? "Check in" : "Back in service"}
          disabled={needPhoto && !mediaId}
          onClick={submit}
        />
      }
    >
      <div className="flex flex-col gap-4 pb-4 pt-1">
        <SegmentedControl
          label="Condition"
          value={condition}
          segments={CONDITION_SEGMENTS}
          onChange={setCondition}
        />
        <HandoffPhoto
          entityId={toolId}
          onMedia={setMediaId}
          required={needPhoto}
        />
        {mode === "check_in" && (
          <>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-body">Needs repair</span>
              <Toggle
                label="Needs repair"
                checked={toRepair || condition === "poor"}
                disabled={condition === "poor"}
                onChange={(e) => setToRepair(e.currentTarget.checked)}
              />
            </div>
            <TextArea
              label="Note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
            />
          </>
        )}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ maintenance

export function MaintenanceSheet({
  open,
  onOpenChange,
  toolId,
  defaultTask,
  today,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  toolId: string;
  defaultTask: string | null;
  today: string;
}) {
  const [clientId, setClientId] = useState(newId);
  const [task, setTask] = useState(defaultTask ?? "");
  const [performedOn, setPerformedOn] = useState(today);
  const [vendor, setVendor] = useState("");
  const [cost, setCost] = useState<number | null>(null);
  const [paidBy, setPaidBy] = useState<"company" | "tech">("company");
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [calibrated, setCalibrated] = useState(false);
  const [nextCal, setNextCal] = useState("");
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await offline<{ id: string }>("tools.logMaintenance", {
        toolId,
        task,
        performedOn,
        vendor,
        costCents: cost,
        paidBy,
        mediaId,
        notes,
        calibrated,
        nextCalibrationOn: nextCal || null,
        clientId,
      });
      if (!r.queued && r.result && !r.result.ok) {
        toast({
          title:
            Object.values(r.result.fieldErrors ?? {})[0]?.[0] ?? r.result.error,
          tone: "error",
        });
        return;
      }
      toast({
        title: r.queued ? "Saved offline — will sync" : "Maintenance logged",
        tone: r.queued ? "warning" : "success",
      });
      onOpenChange(false);
      setClientId(newId());
    });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Log maintenance"
      detents={["large"]}
      dirty={task !== (defaultTask ?? "") || !!cost || !!notes}
      leading={<Cancel close={() => onOpenChange(false)} />}
      footer={
        <Footer
          pending={pending}
          label="Save"
          disabled={!task.trim()}
          onClick={submit}
        />
      }
    >
      <div className="flex flex-col gap-4 pb-4 pt-1">
        <TextField
          label="What was done"
          placeholder="Replaced blades, battery check…"
          value={task}
          onChange={(e) => setTask(e.currentTarget.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <DateField
            label="Date"
            value={performedOn}
            max={today}
            onChange={(e) => setPerformedOn(e.currentTarget.value)}
          />
          <TextField
            label="Vendor (optional)"
            value={vendor}
            onChange={(e) => setVendor(e.currentTarget.value)}
          />
          <MoneyField label="Cost" valueCents={cost} onChangeCents={setCost} />
        </div>
        {!!cost && (
          <SegmentedControl
            label="Paid by"
            value={paidBy}
            segments={[
              { value: "company", label: "Company" },
              { value: "tech", label: "Me (reimburse)" },
            ]}
            onChange={setPaidBy}
          />
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead font-semibold">Photo or receipt</span>
          <CameraButton
            kind="photo"
            tag="receipt"
            entity={{ type: "tool", id: toolId }}
            label={mediaId ? "Retake" : "Take photo"}
            icon={<Camera size={18} aria-hidden />}
            variant="tinted"
            showLibrary
            onUploaded={(r) => setMediaId(r.mediaId)}
          />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-body">This was a calibration</span>
          <Toggle
            label="This was a calibration"
            checked={calibrated}
            onChange={(e) => setCalibrated(e.currentTarget.checked)}
          />
        </div>
        {calibrated && (
          <DateField
            label="Next calibration due"
            value={nextCal}
            min={today}
            onChange={(e) => setNextCal(e.currentTarget.value)}
          />
        )}
        <TextArea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ incidents

export function IncidentSheet({
  open,
  onOpenChange,
  toolId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  toolId: string;
}) {
  const [clientId, setClientId] = useState(newId);
  const [kind, setKind] = useState<"lost" | "stolen" | "damaged">("damaged");
  const [description, setDescription] = useState("");
  const [police, setPolice] = useState("");
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await offline<{ id: string }>("tools.reportIncident", {
        toolId,
        kind,
        description,
        mediaIds,
        policeReportNo: police || null,
        clientId,
      });
      if (!r.queued && r.result && !r.result.ok) {
        toast({
          title:
            Object.values(r.result.fieldErrors ?? {})[0]?.[0] ?? r.result.error,
          tone: "error",
        });
        return;
      }
      toast({
        title: r.queued
          ? "Saved offline — will sync"
          : "Reported — the office was notified",
        tone: r.queued ? "warning" : "success",
      });
      onOpenChange(false);
      setClientId(newId());
      setDescription("");
    });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Report a problem"
      detents={["large"]}
      dirty={!!description}
      leading={<Cancel close={() => onOpenChange(false)} />}
      footer={
        <Footer
          pending={pending}
          label="Report"
          disabled={description.trim().length < 3}
          onClick={submit}
          destructive={kind !== "damaged"}
        />
      }
    >
      <div className="flex flex-col gap-4 pb-4 pt-1">
        <SegmentedControl
          label="What happened"
          value={kind}
          segments={[
            { value: "damaged", label: "Damaged" },
            { value: "lost", label: "Lost" },
            { value: "stolen", label: "Stolen" },
          ]}
          onChange={setKind}
        />
        <TextArea
          label="Details"
          rows={4}
          placeholder="When and where, what you noticed"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        {kind === "stolen" && (
          <TextField
            label="Police report # (optional)"
            value={police}
            onChange={(e) => setPolice(e.currentTarget.value)}
          />
        )}
        <CameraButton
          kind="photo"
          tag="problem"
          entity={{ type: "tool", id: toolId }}
          label={
            mediaIds.length ? `Add photo (${mediaIds.length})` : "Add photos"
          }
          variant="tinted"
          multiple
          showLibrary
          onUploaded={(r) => setMediaIds((m) => [...m, r.mediaId])}
        />
      </div>
    </Sheet>
  );
}

export function DecideIncidentSheet({
  open,
  onOpenChange,
  incidentId,
  defaultAmountCents,
  deductionsEnabled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  incidentId: string;
  defaultAmountCents: number | null;
  deductionsEnabled: boolean;
}) {
  const [decision, setDecision] = useState<
    "write_off" | "repair" | "tech_responsibility"
  >("write_off");
  const [amount, setAmount] = useState<number | null>(defaultAmountCents);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await decideToolIncident({
        incidentId,
        decision,
        amountCents: decision === "tech_responsibility" ? amount : null,
      });
      if (!r.ok) {
        toast({ title: r.error, tone: "error" });
        return;
      }
      toast({ title: "Decision saved", tone: "success" });
      onOpenChange(false);
    });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Decide incident"
      detents={["medium", "large"]}
      leading={<Cancel close={() => onOpenChange(false)} />}
      footer={
        <Footer pending={pending} label="Save decision" onClick={submit} />
      }
    >
      <div className="flex flex-col gap-4 pb-4 pt-1">
        <ChipRow label="Decision">
          <Chip
            selected={decision === "write_off"}
            onClick={() => setDecision("write_off")}
          >
            Write off
          </Chip>
          <Chip
            selected={decision === "repair"}
            onClick={() => setDecision("repair")}
          >
            Repair
          </Chip>
          <Chip
            selected={decision === "tech_responsibility"}
            onClick={() => setDecision("tech_responsibility")}
          >
            Tech responsibility
          </Chip>
        </ChipRow>
        {decision === "tech_responsibility" &&
          (deductionsEnabled ? (
            <>
              <MoneyField
                label="Deduction amount"
                valueCents={amount}
                onChangeCents={setAmount}
              />
              <p className="text-footnote text-label-2">
                ⚖️ Creates a pending deduction for payroll review. Blocked for
                W-2 employees in states that restrict wage deductions, and only
                with a signed tool agreement.
              </p>
            </>
          ) : (
            <p className="text-footnote text-label-2">
              ⚖️ Tool deductions are off (Settings → Tools). The decision is
              recorded without a deduction — consider a tool deposit or
              allowance instead.
            </p>
          ))}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ kits & audits

export function KitSheet({
  open,
  onOpenChange,
  kit,
  tools,
  users,
  vehicles,
  requirePhoto,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kit: {
    id: string;
    name: string;
    vehicleId: string | null;
    userId: string | null;
    toolIds: string[];
  } | null;
  tools: PickTool[];
  users: Opt[];
  vehicles: Opt[];
  requirePhoto: boolean;
}) {
  const [name, setName] = useState(kit?.name ?? "");
  const [vehicleId, setVehicleId] = useState(kit?.vehicleId ?? "");
  const [userId, setUserId] = useState(kit?.userId ?? "");
  const [picked, setPicked] = useState<string[]>(kit?.toolIds ?? []);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [anchor] = useState(newId);
  const [pending, start] = useTransition();
  const save = (assign: boolean) =>
    start(async () => {
      const r = await saveKit({
        id: kit?.id,
        name,
        vehicleId: vehicleId || null,
        userId: userId || null,
        toolIds: picked,
      });
      if (!r.ok || !r.data) {
        toast({ title: r.ok ? "Couldn't save" : r.error, tone: "error" });
        return;
      }
      if (assign) {
        const a = await assignKit({ kitId: r.data.id, mediaId });
        if (!a.ok) {
          toast({
            title: Object.values(a.fieldErrors ?? {})[0]?.[0] ?? a.error,
            tone: "error",
          });
          return;
        }
        toast({
          title: `Kit assigned (${a.data?.assigned ?? 0})`,
          message: a.data?.skipped
            ? `${a.data.skipped} blocked (repair or calibration)`
            : undefined,
          tone: "success",
        });
      } else toast({ title: "Kit saved", tone: "success" });
      onOpenChange(false);
    });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={kit ? kit.name : "New kit"}
      detents={["large"]}
      desktop="panel"
      leading={<Cancel close={() => onOpenChange(false)} />}
      footer={
        <div className="flex gap-2">
          <Button
            variant="gray"
            size="lg"
            className="flex-1"
            loading={pending}
            disabled={!name.trim()}
            onClick={() => save(false)}
          >
            Save
          </Button>
          <Button
            size="lg"
            className="flex-1"
            loading={pending}
            disabled={
              !name.trim() ||
              (!vehicleId && !userId) ||
              (requirePhoto && !mediaId)
            }
            onClick={() => save(true)}
          >
            Save & assign
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-4 pt-1">
        <TextField
          label="Kit name"
          placeholder="Locksmith kit"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Vehicle"
            value={vehicleId}
            placeholder="—"
            options={vehicles.map((v) => ({ value: v.id, label: v.name }))}
            onChange={(e) => setVehicleId(e.currentTarget.value)}
          />
          <Select
            label="Tech"
            value={userId}
            placeholder="—"
            options={users.map((v) => ({ value: v.id, label: v.name }))}
            onChange={(e) => setUserId(e.currentTarget.value)}
          />
        </div>
        <HandoffPhoto
          entityId={anchor}
          onMedia={setMediaId}
          required={requirePhoto}
          label="Photo when assigning"
        />
        <ul
          className="list-card max-h-[40dvh] overflow-y-auto"
          aria-label="Tools in this kit"
        >
          {tools.map((t) => (
            <li key={t.id} className="list-row">
              <label className="flex min-h-11 items-center gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--accent)]"
                  checked={picked.includes(t.id)}
                  onChange={() =>
                    setPicked((p) =>
                      p.includes(t.id)
                        ? p.filter((x) => x !== t.id)
                        : [...p, t.id],
                    )
                  }
                />
                <span className="min-w-0 flex-1 truncate text-body">
                  {t.name}
                </span>
                <span className="text-footnote text-label-2">{t.assetTag}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

export function ScheduleAuditSheet({
  open,
  onOpenChange,
  users,
  today,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  users: Opt[];
  today: string;
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [dueOn, setDueOn] = useState(today);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await scheduleAudit({ userId, dueOn });
      if (!r.ok) {
        toast({ title: r.error, tone: "error" });
        return;
      }
      toast({
        title: "Tool check scheduled — the tech was notified",
        tone: "success",
      });
      onOpenChange(false);
    });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Schedule tool check"
      detents={["medium"]}
      leading={<Cancel close={() => onOpenChange(false)} />}
      footer={
        <Footer
          pending={pending}
          label="Schedule"
          disabled={!userId}
          onClick={submit}
        />
      }
    >
      <div className="flex flex-col gap-4 pb-4 pt-1">
        <Select
          label="Tech"
          value={userId}
          options={users.map((u) => ({ value: u.id, label: u.name }))}
          onChange={(e) => setUserId(e.currentTarget.value)}
        />
        <DateField
          label="Due"
          value={dueOn}
          min={today}
          onChange={(e) => setDueOn(e.currentTarget.value)}
        />
        <p className="text-footnote text-label-2">
          The tech gets a checklist with one photo per tool in their custody.
          Missing tools become incidents.
        </p>
      </div>
    </Sheet>
  );
}
