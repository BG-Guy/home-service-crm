"use client";

import { Lock, Plus, RotateCcw, Search } from "lucide-react";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import {
  createRoleAction,
  resetRolePermissionsAction,
  setRolePermissionAction,
} from "../actions";
import { FieldCard, FormErrors, FSelect, FText, useActionForm } from "./form";

export interface GridRole {
  key: string;
  name: string;
  baseRole: "admin" | "office" | "tech";
  builtin: boolean;
  members: number;
}

export interface GridSection {
  key: string;
  name: string;
  /** The module's feature flag is off (perms still editable). */
  flagOff: boolean;
  perms: { key: string; label: string; description: string }[];
}

type Grid = Record<string, Record<string, boolean>>;

/**
 * Settings → Permissions grid (SPEC §4.1): modules (sections) × roles with iOS
 * toggles. Phones pick one role at a time; desktop shows every role as a column.
 * Saves instantly (audited server-side); locked cells can't be switched off.
 */
export function PermissionGrid({
  roles,
  sections,
  grid: initial,
  defaults,
  lockedForAdmin,
}: {
  roles: GridRole[];
  sections: GridSection[];
  grid: Grid;
  defaults: Grid;
  lockedForAdmin: string[];
}) {
  const [grid, setCell] = useOptimistic(
    initial,
    (g, u: { role: string; perm: string; on: boolean }) => ({
      ...g,
      [u.role]: { ...g[u.role], [u.perm]: u.on },
    }),
  );
  const [, start] = useTransition();
  const [role, setRole] = useState(
    roles.find((r) => r.key === "office")?.key ?? roles[0]?.key ?? "",
  );
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirm, confirmEl] = useConfirm();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sections;
    return sections
      .map((s) => ({
        ...s,
        perms: s.perms.filter(
          (p) =>
            p.key.includes(needle) ||
            p.label.toLowerCase().includes(needle) ||
            p.description.toLowerCase().includes(needle) ||
            s.name.toLowerCase().includes(needle),
        ),
      }))
      .filter((s) => s.perms.length > 0);
  }, [q, sections]);

  const locked = (r: GridRole, perm: string) =>
    r.baseRole === "admin" && lockedForAdmin.includes(perm);

  function flip(r: GridRole, perm: string, on: boolean) {
    if (locked(r, perm) && !on) return;
    start(async () => {
      setCell({ role: r.key, perm, on });
      const res = await setRolePermissionAction({
        role: r.key,
        perm,
        granted: on,
      });
      if (!res.ok) toast.error(res.error);
    });
  }

  async function reset(r: GridRole) {
    const ok = await confirm({
      title: `Reset ${r.name} to defaults?`,
      message:
        "Every switch for this role goes back to the built-in defaults. Per-person overrides are kept.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await resetRolePermissionsAction({ role: r.key });
      if (res.ok) toast.success(`${r.name} reset to defaults`);
      else toast.error(res.error);
    });
  }

  const current = roles.find((r) => r.key === role) ?? roles[0];
  const changedCount = (r: GridRole) =>
    sections.reduce(
      (a, s) =>
        a +
        s.perms.filter(
          (p) =>
            (grid[r.key]?.[p.key] ?? false) !==
            (defaults[r.key]?.[p.key] ?? false),
        ).length,
      0,
    );

  return (
    <div className="flex flex-col gap-4">
      {confirmEl}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-fill-3 px-3">
          <Search aria-hidden size={16} className="shrink-0 text-label-2" />
          <span className="sr-only">Filter permissions</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            placeholder="Filter permissions"
            className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-label-3"
          />
        </label>
        <Button
          variant="gray"
          size="sm"
          icon={<Plus aria-hidden size={16} />}
          onClick={() => setCreating(true)}
        >
          New role
        </Button>
      </div>

      {/* Phones and tablets: one role at a time */}
      <div className="flex flex-col gap-[var(--section-gap)] lg:hidden">
        {roles.length <= 4 ? (
          <SegmentedControl
            label="Role"
            value={role}
            onChange={setRole}
            segments={roles.map((r) => ({ value: r.key, label: r.name }))}
          />
        ) : (
          <select
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.currentTarget.value)}
            className="min-h-11 rounded-[10px] bg-card px-3 text-body"
          >
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        {current && (
          <div className="flex items-center justify-between px-4 text-footnote text-label-2">
            <span>
              {current.members} active · {changedCount(current)} changed from
              default
            </span>
            <Button
              variant="plain"
              size="sm"
              icon={<RotateCcw aria-hidden size={14} />}
              onClick={() => reset(current)}
            >
              Reset
            </Button>
          </div>
        )}
        {current &&
          filtered.map((s) => (
            <ListSection
              key={s.key}
              header={
                <span className="flex items-center gap-2">
                  {s.name}
                  {s.flagOff && (
                    <Pill tone="gray" size="sm" dot={false}>
                      Off
                    </Pill>
                  )}
                </span>
              }
            >
              {s.perms.map((p) => {
                const on = grid[current.key]?.[p.key] ?? false;
                const isLocked = locked(current, p.key);
                const changed =
                  on !== (defaults[current.key]?.[p.key] ?? false);
                return (
                  // biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is inside
                  <label
                    key={p.key}
                    className={cx(
                      "list-row flex min-h-11 items-center gap-3 px-4 py-2",
                      isLocked ? "cursor-default" : "cursor-pointer",
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5 text-body">
                        {p.label}
                        {changed && (
                          <span
                            role="img"
                            aria-label="Changed from default"
                            className="size-1.5 rounded-full bg-[var(--sys-orange)]"
                          />
                        )}
                      </span>
                      <span className="text-footnote text-label-2">
                        {p.description}
                      </span>
                    </span>
                    {isLocked ? (
                      <Lock
                        aria-label="Always on for admins"
                        size={16}
                        className="text-label-3"
                      />
                    ) : null}
                    <Toggle
                      checked={on}
                      disabled={isLocked}
                      label={`${p.label} for ${current.name}`}
                      onChange={(e) =>
                        flip(current, p.key, e.currentTarget.checked)
                      }
                    />
                  </label>
                );
              })}
            </ListSection>
          ))}
      </div>

      {/* Desktop: modules × roles. `overflow-clip` (not hidden) rounds the card
          without becoming a scroll container, so the header sticks to the window
          right under the nav bar instead of floating inside the card. */}
      <div className="hidden overflow-clip rounded-card bg-card lg:block">
        <table className="w-full text-left">
          <caption className="sr-only">Permissions by role</caption>
          <thead className="material sticky top-[calc(env(safe-area-inset-top)+44px)] z-10">
            <tr className="hairline-b">
              <th
                scope="col"
                className="px-4 py-3 text-footnote font-medium text-label-2"
              >
                Permission
              </th>
              {roles.map((r) => (
                <th
                  key={r.key}
                  scope="col"
                  className="w-28 px-2 py-2 text-center"
                >
                  <span className="block text-subhead font-semibold">
                    {r.name}
                  </span>
                  <span className="block text-caption text-label-2">
                    {r.members} active
                  </span>
                  <button
                    type="button"
                    onClick={() => reset(r)}
                    className="mt-0.5 text-caption text-accent-text hover:underline"
                  >
                    Reset
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          {filtered.map((s) => (
            <tbody key={s.key}>
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={roles.length + 1}
                  className="bg-fill-3 px-4 py-1.5 text-subhead font-semibold text-label-2"
                >
                  {s.name}
                  {s.flagOff && (
                    <span className="ml-2 font-normal">(module off)</span>
                  )}
                </th>
              </tr>
              {s.perms.map((p) => (
                <tr key={p.key} className="hairline-b">
                  <th scope="row" className="px-4 py-2 font-normal">
                    <span className="block text-body">{p.label}</span>
                    <span className="block text-footnote text-label-2">
                      {p.description}
                    </span>
                  </th>
                  {roles.map((r) => {
                    const on = grid[r.key]?.[p.key] ?? false;
                    const isLocked = locked(r, p.key);
                    const changed = on !== (defaults[r.key]?.[p.key] ?? false);
                    return (
                      <td
                        key={r.key}
                        className="px-2 text-center"
                        title={isLocked ? "Always on for admins" : undefined}
                      >
                        <span className="relative inline-flex items-center">
                          <Toggle
                            checked={on}
                            disabled={isLocked}
                            label={`${p.label} for ${r.name}`}
                            onChange={(e) =>
                              flip(r, p.key, e.currentTarget.checked)
                            }
                          />
                          {changed && (
                            <span
                              role="img"
                              aria-label="Changed from default"
                              className="absolute -right-2.5 top-0 size-1.5 rounded-full bg-[var(--sys-orange)]"
                            />
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {filtered.length === 0 && (
        <p className="px-4 py-8 text-center text-subhead text-label-2">
          No permission matches “{q}”.
        </p>
      )}
      {creating && <NewRoleSheet onClosed={() => setCreating(false)} />}
    </div>
  );
}

function NewRoleSheet({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(true);
  const f = useActionForm(createRoleAction, {
    success: "Role created",
    onSuccess: () => setOpen(false),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClosed}
      title="New role"
      detents={["content"]}
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
          Create
        </Button>
      }
    >
      <FormErrors errors={f.errors}>
        <form {...f.formProps} className="flex flex-col gap-4 pb-6">
          <FieldCard footer="A role starts with the defaults of the base role; adjust its switches afterwards.">
            <FText
              name="name"
              label="Name"
              placeholder="Dispatcher"
              required
              autoFocus
            />
            <FSelect
              name="baseRole"
              label="Based on"
              defaultValue="office"
              options={[
                { value: "office", label: "Office" },
                { value: "tech", label: "Technician" },
                { value: "admin", label: "Admin" },
              ]}
            />
          </FieldCard>
        </form>
      </FormErrors>
    </Sheet>
  );
}
