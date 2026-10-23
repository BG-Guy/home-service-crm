"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ColorSwatches } from "@/features/settings/components/ColorSwatches";
import {
  FieldCard,
  FieldErrorText,
  FormErrors,
  FText,
  useActionForm,
} from "@/features/settings/components/form";
import { ImageUpload } from "@/features/settings/components/ImageUpload";
import { SWATCHES } from "@/features/settings/options";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { Toggle, ToggleRow } from "@/ui/components/Toggle";
import { setMemberAvatarAction, updateMemberAction } from "../actions";
import { WORKER_TYPE_NOTES } from "../rules";

export interface EditableMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  color: string | null;
  avatarUrl: string | null;
  hireDate: string | null;
  experienceYears: number | null;
  birthDate: string | null;
  workerType: "w2" | "1099";
  baseRole: string;
  usesCompanyTools: boolean;
  usesCompanyVehicle: boolean;
  serviceZips: string[];
  skills: string[];
  licenses: {
    state: string;
    trade: string;
    number: string;
    expires_on?: string;
  }[];
  homeBase: {
    street?: string;
    unit?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
}

let licenseSeq = 0;

export default function EditMemberSheet({
  member,
  skills,
  onClosed,
}: {
  member: EditableMember;
  skills: { id: string; name: string }[];
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [worker, setWorker] = useState(member.workerType);
  const [licenses, setLicenses] = useState(() =>
    member.licenses.map((l) => ({ ...l, k: ++licenseSeq })),
  );
  const f = useActionForm(updateMemberAction, {
    success: "Profile saved",
    onSuccess: () => {
      setDirty(false);
      setOpen(false);
    },
  });
  const tech = member.baseRole === "tech";
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClosed}
      dirty={dirty}
      title="Edit profile"
      detents={["large"]}
      desktop="panel"
      leading={
        <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          type="submit"
          form={f.id}
          loading={f.pending}
          className="font-semibold"
        >
          Save
        </Button>
      }
    >
      <div className="flex justify-center pb-4 pt-2">
        <ImageUpload
          kind="avatar"
          label="Photo"
          shape="circle"
          size={88}
          currentUrl={member.avatarUrl}
          hint="Shown on the customer's job page"
          onSave={(mediaId) =>
            setMemberAvatarAction({ userId: member.id, mediaId })
          }
        />
      </div>
      <FormErrors errors={f.errors}>
        <form
          {...f.formProps}
          onChange={() => setDirty(true)}
          className="flex flex-col gap-6 pb-8"
        >
          <input type="hidden" name="userId" value={member.id} />
          <FieldCard header="Contact">
            <FText
              name="name"
              label="Name"
              defaultValue={member.name}
              required
            />
            <FText
              name="email"
              label="Email"
              type="email"
              inputMode="email"
              defaultValue={member.email}
              required
            />
            <FText
              name="phone"
              label="Mobile"
              type="tel"
              inputMode="tel"
              defaultValue={member.phone ?? ""}
            />
          </FieldCard>

          <FieldCard
            header="Experience"
            footer="⚖️ Date of birth is private: only people who manage the team (and the member) see it or the age. It is never used to rank who gets a job."
          >
            <FText
              name="hireDate"
              label="Hire date"
              type="date"
              defaultValue={member.hireDate ?? ""}
            />
            <FText
              name="experienceYears"
              label="Years in the trade"
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              step={1}
              defaultValue={
                member.experienceYears == null
                  ? ""
                  : String(member.experienceYears)
              }
            />
            <FText
              name="birthDate"
              label="Date of birth"
              type="date"
              defaultValue={member.birthDate ?? ""}
            />
          </FieldCard>

          <section>
            <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
              Calendar color
            </h2>
            <div className="rounded-card bg-card p-4">
              <ColorSwatches
                label="Calendar color"
                name="color"
                allowNone
                defaultValue={member.color}
                options={SWATCHES.map((c) => ({ value: c.hex, name: c.name }))}
              />
            </div>
          </section>

          <section>
            <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
              Worker type
            </h2>
            <div className="rounded-card bg-card p-3">
              <SegmentedControl
                label="Worker type"
                name="workerType"
                value={worker}
                onChange={(v) => {
                  setWorker(v);
                  setDirty(true);
                }}
                segments={[
                  { value: "1099", label: "1099 contractor" },
                  { value: "w2", label: "W-2 employee" },
                ]}
              />
            </div>
            <p className="px-4 pt-1.5 text-footnote text-label-2">
              ⚖️ {WORKER_TYPE_NOTES[worker]}
              {worker !== member.workerType &&
                " Switching applies to new pay periods; review their commission plan and cash policy after saving."}
            </p>
          </section>

          <ListSection header="Equipment">
            <ToggleRow
              title="Uses company tools"
              subtitle="Tool checks and custody apply"
              name="usesCompanyTools"
              defaultChecked={member.usesCompanyTools}
            />
            <ToggleRow
              title="Drives a company vehicle"
              subtitle="Off = own vehicle (mileage reimbursement)"
              name="usesCompanyVehicle"
              defaultChecked={member.usesCompanyVehicle}
            />
          </ListSection>

          {(tech || member.skills.length > 0) && skills.length > 0 && (
            <ListSection
              header="Skills"
              footer="Job types this person can do. Booking and the Assign hub match jobs to these."
            >
              {skills.map((s) => (
                // biome-ignore lint/a11y/noLabelWithoutControl: input is inside
                <label
                  key={s.id}
                  className="list-row flex min-h-11 cursor-pointer items-center gap-3 px-4"
                >
                  <span className="flex-1 text-body">{s.name}</span>
                  <Toggle
                    name="skills[]"
                    value={s.id}
                    defaultChecked={member.skills.includes(s.id)}
                    label={s.name}
                  />
                </label>
              ))}
            </ListSection>
          )}

          <FieldCard
            header="Service area"
            footer="ZIPs this person covers (leave empty for the whole company area)."
          >
            <FText
              name="serviceZips"
              label="ZIP codes"
              defaultValue={member.serviceZips.join(", ")}
              placeholder="78701, 78702, 78704"
              inputMode="numeric"
            />
          </FieldCard>

          <FieldCard header="Home base" footer="Used for drive-distance hints.">
            <FText
              name="home.street"
              label="Street"
              defaultValue={member.homeBase?.street ?? ""}
              autoComplete="off"
            />
            <div className="grid grid-cols-[1fr_72px_96px] gap-3">
              <FText
                name="home.city"
                label="City"
                defaultValue={member.homeBase?.city ?? ""}
              />
              <FText
                name="home.state"
                label="State"
                maxLength={2}
                defaultValue={member.homeBase?.state ?? ""}
              />
              <FText
                name="home.zip"
                label="ZIP"
                inputMode="numeric"
                defaultValue={member.homeBase?.zip ?? ""}
              />
            </div>
          </FieldCard>

          <section>
            <div className="flex items-end justify-between px-4 pb-1.5">
              <h2 className="text-subhead font-semibold text-label-2">
                Licenses
              </h2>
              <Button
                variant="plain"
                size="sm"
                icon={<Plus aria-hidden size={16} />}
                onClick={() => {
                  setLicenses((l) => [
                    ...l,
                    { state: "", trade: "", number: "", k: ++licenseSeq },
                  ]);
                  setDirty(true);
                }}
              >
                Add
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              {licenses.length === 0 && (
                <p className="rounded-card bg-card px-4 py-3 text-subhead text-label-2">
                  No licenses. Add one if it must print on estimates and
                  invoices.
                </p>
              )}
              {licenses.map((l, i) => (
                <div
                  key={l.k}
                  className="flex flex-col gap-3 rounded-card bg-card p-4"
                >
                  <div className="grid grid-cols-[72px_1fr_auto] items-end gap-3">
                    <FText
                      name={`licenses.${i}.state`}
                      label="State"
                      maxLength={2}
                      defaultValue={l.state}
                    />
                    <FText
                      name={`licenses.${i}.trade`}
                      label="Trade"
                      placeholder="Locksmith"
                      defaultValue={l.trade}
                    />
                    <IconButton
                      label="Remove license"
                      variant="gray"
                      size={36}
                      onClick={() => {
                        setLicenses((x) => x.filter((y) => y.k !== l.k));
                        setDirty(true);
                      }}
                    >
                      <Trash2 size={16} aria-hidden />
                    </IconButton>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FText
                      name={`licenses.${i}.number`}
                      label="Number"
                      defaultValue={l.number}
                    />
                    <FText
                      name={`licenses.${i}.expires_on`}
                      label="Expires"
                      type="date"
                      defaultValue={l.expires_on ?? ""}
                    />
                  </div>
                </div>
              ))}
              <FieldErrorText name="licenses" className="px-4" />
            </div>
          </section>
        </form>
      </FormErrors>
    </Sheet>
  );
}
