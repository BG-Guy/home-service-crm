"use client";

import { ScanLine } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useState,
  useTransition,
} from "react";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { CustomFieldsFields } from "@/features/settings/slots.client";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { Select, TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { decodeVin, saveVehicle } from "../actions";
import type { DecodedVin, VehicleFormValues } from "../contracts";
import { fe, newId, SheetSave } from "./sheets/shared";

export interface VehicleFormProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: VehicleFormValues | null;
  users: { id: string; name: string }[];
  customDefs: CustomFieldDef[];
}

const STATES =
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  );

/** Why a typed VIN can't be decoded, or null when it looks valid. */
function vinProblem(vin: string): string | null {
  const v = vin.trim().toUpperCase();
  if (/[IOQ]/.test(v)) return "VINs never use the letters I, O or Q.";
  if (/[^A-Z0-9]/.test(v)) return "Use only letters and numbers.";
  if (v.length !== 17)
    return `A VIN has 17 characters. This one has ${v.length}.`;
  return null;
}

/** Create / edit a vehicle: VIN decode (NHTSA vPIC), USDOT when GVWR ≥ 10,001 lb, photos. */
export default function VehicleForm({
  open,
  onOpenChange,
  initial,
  users,
  customDefs,
}: VehicleFormProps) {
  const router = useRouter();
  const isNew = !initial?.id;
  const [id] = useState(() => initial?.id ?? newId());
  const [v, setV] = useState<VehicleFormValues>(
    () =>
      initial ?? {
        nickname: "",
        vin: null,
        year: null,
        make: null,
        model: null,
        trim: null,
        engine: null,
        fuelType: null,
        gvwrLbs: null,
        usdotNumber: null,
        plate: null,
        plateState: null,
        ownership: "company_owned",
        assignedUserId: null,
        tankGal: null,
        status: "active",
        custom: {},
      },
  );
  const [decoded, setDecoded] = useState<DecodedVin | null>(null);
  const [decoding, startDecode] = useTransition();
  const [vinError, setVinError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof VehicleFormValues>(
    k: K,
    val: VehicleFormValues[K],
  ) => {
    setDirty(true);
    setV((x) => ({ ...x, [k]: val }));
  };
  const str = (x: string | number | null | undefined) =>
    x == null ? "" : String(x);

  const [state, formAction, pending] = useActionState(
    async (
      prev: Awaited<ReturnType<typeof saveVehicle>> | null,
      fd: FormData,
    ) => {
      const r = await saveVehicle(prev, fd);
      if (r.ok) {
        toast({
          title: isNew ? "Vehicle added" : "Vehicle saved",
          tone: "success",
        });
        setDirty(false);
        onOpenChange(false);
        if (isNew && r.data) router.push(`/vehicles/${r.data.id}`);
      }
      return r;
    },
    null,
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  const decode = () => {
    // Say why a VIN can't be decoded instead of a silently disabled button (QA T3-23).
    const problem = vinProblem(v.vin ?? "");
    if (problem) {
      setVinError(problem);
      return;
    }
    setVinError(null);
    startDecode(async () => {
      const r = await decodeVin(v.vin ?? "");
      if (!r.ok) {
        setVinError(r.error);
        return;
      }
      const d = r.data;
      setDecoded(d);
      setDirty(true);
      setV((x) => ({
        ...x,
        year: d.year ?? x.year,
        make: d.make ?? x.make,
        model: d.model ?? x.model,
        trim: d.trim ?? x.trim,
        engine: d.engine ?? x.engine,
        fuelType: d.fuel ?? x.fuelType,
        gvwrLbs: d.gvwrLb ?? x.gvwrLbs,
        nickname: x.nickname || [d.make, d.model].filter(Boolean).join(" "),
      }));
      toast({
        title: "VIN decoded",
        message: [d.year, d.make, d.model].filter(Boolean).join(" "),
        tone: "success",
      });
    });
  };

  const formId = `veh-${id}`;
  const heavy = (v.gvwrLbs ?? 0) >= 10_001;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={isNew ? "New vehicle" : "Edit vehicle"}
      dirty={dirty}
      desktop="panel"
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <SheetSave form={formId} pending={pending}>
          {isNew ? "Add vehicle" : "Save"}
        </SheetSave>
      }
    >
      <form
        id={formId}
        // onSubmit, not `action`: a form action resets uncontrolled fields
        // (odometer, custom fields) even when the save fails (QA2 re-check).
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
        className="flex flex-col gap-4 pb-6 pt-1"
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="isNew" value={String(isNew)} />
        <input
          type="hidden"
          name="decoded"
          value={decoded ? JSON.stringify(decoded) : ""}
        />
        <TextField
          label="Name"
          name="nickname"
          placeholder="Van 3"
          value={v.nickname}
          onChange={(e) => set("nickname", e.currentTarget.value)}
          error={fe(errors, "nickname")}
          required
        />
        <div className="flex items-end gap-2">
          <TextField
            label="VIN"
            name="vin"
            className="flex-1"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={17}
            placeholder="17 characters"
            value={str(v.vin)}
            onChange={(e) => {
              setVinError(null);
              set("vin", e.currentTarget.value.toUpperCase());
            }}
            error={vinError ?? fe(errors, "vin")}
          />
          <Button
            variant="tinted"
            icon={<ScanLine size={18} aria-hidden />}
            loading={decoding}
            disabled={!(v.vin ?? "").trim()}
            onClick={decode}
          >
            Decode
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <TextField
            label="Year"
            name="year"
            inputMode="numeric"
            value={str(v.year)}
            onChange={(e) =>
              set(
                "year",
                e.currentTarget.value
                  ? Number(e.currentTarget.value.replace(/\D/g, "").slice(0, 4))
                  : null,
              )
            }
            error={fe(errors, "year")}
          />
          <TextField
            label="Make"
            name="make"
            value={str(v.make)}
            onChange={(e) => set("make", e.currentTarget.value)}
          />
          <TextField
            label="Model"
            name="model"
            value={str(v.model)}
            onChange={(e) => set("model", e.currentTarget.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Trim"
            name="trim"
            value={str(v.trim)}
            onChange={(e) => set("trim", e.currentTarget.value)}
          />
          <TextField
            label="Engine"
            name="engine"
            value={str(v.engine)}
            onChange={(e) => set("engine", e.currentTarget.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Fuel"
            name="fuelType"
            value={str(v.fuelType)}
            onChange={(e) => set("fuelType", e.currentTarget.value)}
          />
          <TextField
            label="Tank (gal)"
            name="tankGal"
            inputMode="decimal"
            value={str(v.tankGal)}
            onChange={(e) =>
              set(
                "tankGal",
                e.currentTarget.value
                  ? Number(e.currentTarget.value.replace(/[^\d.]/g, ""))
                  : null,
              )
            }
            error={fe(errors, "tankGal")}
          />
        </div>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <TextField
            label="Plate"
            name="plate"
            autoCapitalize="characters"
            value={str(v.plate)}
            onChange={(e) => set("plate", e.currentTarget.value.toUpperCase())}
          />
          <Select
            label="State"
            name="plateState"
            value={str(v.plateState)}
            placeholder="—"
            onChange={(e) => set("plateState", e.currentTarget.value || null)}
            options={STATES.map((s) => ({ value: s, label: s }))}
          />
        </div>
        <TextField
          label="GVWR (lb)"
          name="gvwrLbs"
          inputMode="numeric"
          value={str(v.gvwrLbs)}
          onChange={(e) =>
            set(
              "gvwrLbs",
              e.currentTarget.value
                ? Number(e.currentTarget.value.replace(/\D/g, ""))
                : null,
            )
          }
          hint={
            heavy
              ? "Over 10,000 lb: USDOT rules may apply."
              : "Filled in by the VIN decode."
          }
        />
        {heavy && (
          <TextField
            label="USDOT number"
            name="usdotNumber"
            inputMode="numeric"
            value={str(v.usdotNumber)}
            onChange={(e) => set("usdotNumber", e.currentTarget.value)}
          />
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead font-semibold">Ownership</span>
          <SegmentedControl
            label="Ownership"
            name="ownership"
            value={v.ownership}
            onChange={(o) => set("ownership", o)}
            segments={[
              { value: "company_owned", label: "Company" },
              { value: "leased", label: "Leased" },
              { value: "tech_owned", label: "Tech-owned" },
            ]}
          />
          {v.ownership === "tech_owned" && (
            <p className="text-footnote text-label-2">
              Business trips are reimbursed at the IRS mileage rate.
            </p>
          )}
        </div>
        <Select
          label="Assigned to"
          name="assignedUserId"
          value={str(v.assignedUserId)}
          placeholder="Unassigned"
          onChange={(e) => set("assignedUserId", e.currentTarget.value || null)}
          options={users.map((u) => ({ value: u.id, label: u.name }))}
          error={fe(errors, "assignedUserId")}
        />
        {isNew ? (
          <TextField
            label="Current odometer"
            name="odometer"
            inputMode="numeric"
            placeholder="Miles"
            error={fe(errors, "odometer")}
          />
        ) : (
          <Select
            label="Status"
            name="status"
            value={v.status}
            onChange={(e) =>
              set(
                "status",
                e.currentTarget.value as VehicleFormValues["status"],
              )
            }
            options={[
              { value: "active", label: "Active" },
              { value: "in_shop", label: "In the shop" },
              { value: "retired", label: "Retired" },
            ]}
          />
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-subhead font-semibold">Photos</span>
          <CameraButton
            kind="photo"
            tag="other"
            entity={{ type: "vehicle", id }}
            label="Add photo"
            variant="gray"
            geo={false}
          />
        </div>
        {customDefs.length > 0 && (
          <ListSection header="More details">
            <div className="flex flex-col gap-3 p-4">
              <CustomFieldsFields defs={customDefs} values={v.custom} />
            </div>
          </ListSection>
        )}
        {state && !state.ok && !errors && (
          <p role="alert" className="text-footnote text-danger">
            {state.error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
