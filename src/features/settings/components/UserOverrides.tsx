"use client";

import { Search } from "lucide-react";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import { setUserOverrideAction } from "../actions";
import type { GridSection } from "./PermissionGrid";

type Effect = "inherit" | "allow" | "deny";

/**
 * Per-user overrides (SPEC §4.1): Inherit / Allow / Deny per permission. Shows what
 * the role grants and the effective result. Locks: non-admins can't be allowed
 * settings.permissions; admins can't be denied their locked permissions.
 */
export function UserOverrides({
  userId,
  roleName,
  sections,
  roleGrants,
  overrides: initial,
  lockAllow,
  lockDeny,
}: {
  userId: string;
  roleName: string;
  sections: GridSection[];
  roleGrants: Record<string, boolean>;
  overrides: Record<string, "allow" | "deny">;
  lockAllow: string[];
  lockDeny: string[];
}) {
  const [overrides, setOv] = useOptimistic(
    initial,
    (s, u: { perm: string; effect: Effect }) => {
      const next = { ...s };
      if (u.effect === "inherit") delete next[u.perm];
      else next[u.perm] = u.effect;
      return next;
    },
  );
  const [, start] = useTransition();
  const [q, setQ] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(
    Object.keys(initial).length > 0,
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sections
      .map((s) => ({
        ...s,
        perms: s.perms.filter(
          (p) =>
            (!onlyChanged || overrides[p.key]) &&
            (!needle ||
              p.key.includes(needle) ||
              p.label.toLowerCase().includes(needle) ||
              p.description.toLowerCase().includes(needle) ||
              s.name.toLowerCase().includes(needle)),
        ),
      }))
      .filter((s) => s.perms.length > 0);
  }, [q, sections, onlyChanged, overrides]);

  function set(perm: string, effect: Effect) {
    start(async () => {
      setOv({ perm, effect });
      const r = await setUserOverrideAction({ userId, perm, effect });
      if (r.ok)
        toast.success(
          effect === "inherit" ? "Back to role default" : `Override: ${effect}`,
        );
      else toast.error(r.error);
    });
  }

  const count = Object.keys(overrides).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SegmentedControl
          label="Show"
          value={onlyChanged ? "changed" : "all"}
          onChange={(v) => setOnlyChanged(v === "changed")}
          segments={[
            { value: "changed", label: `Overrides (${count})` },
            { value: "all", label: "All permissions" },
          ]}
        />
        {!onlyChanged && (
          <label className="flex min-h-11 items-center gap-2 rounded-[10px] bg-fill-3 px-3">
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
        )}
      </div>
      {visible.length === 0 && (
        <p className="rounded-card bg-card px-4 py-6 text-center text-subhead text-label-2">
          {onlyChanged
            ? `No overrides — this person has exactly the ${roleName} permissions. Switch to “All permissions” to add one.`
            : `No permission matches “${q}”.`}
        </p>
      )}
      {visible.map((s) => (
        <ListSection key={s.key} header={s.name}>
          {s.perms.map((p) => {
            const ov = overrides[p.key];
            const role = roleGrants[p.key] ?? false;
            const effective = ov ? ov === "allow" : role;
            const effect: Effect = ov ?? "inherit";
            const allowLocked = lockAllow.includes(p.key);
            const denyLocked = lockDeny.includes(p.key);
            return (
              <div
                key={p.key}
                className="list-row flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-body">
                    {p.label}
                    <Pill tone={effective ? "green" : "gray"} size="sm">
                      {effective ? "Allowed" : "Off"}
                    </Pill>
                  </span>
                  <span className="text-footnote text-label-2">
                    {p.description} · {roleName}: {role ? "on" : "off"}
                    {allowLocked && " · admins only"}
                    {denyLocked && " · always on for admins"}
                  </span>
                </div>
                <SegmentedControl
                  className="w-full sm:w-64"
                  label={`${p.label} override`}
                  value={effect}
                  onChange={(v) => set(p.key, v)}
                  segments={[
                    { value: "inherit", label: "Inherit" },
                    { value: "allow", label: "Allow", disabled: allowLocked },
                    { value: "deny", label: "Deny", disabled: denyLocked },
                  ]}
                />
              </div>
            );
          })}
        </ListSection>
      ))}
    </div>
  );
}
