"use client";

import { KeyRound, MapPin, Plus, Star } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { ListRow, ListSection } from "@/ui/components/List";
import type { PropertyView } from "../contracts";

// The address form loads on the first tap (own chunk with the Sheet and fields).
const loadSheet = () => import("./PropertySheet");
const PropertySheet = dynamic(loadSheet, { ssr: false });

/** Service addresses with add/edit sheet (gate code encrypted at rest). */
export function PropertiesList({
  customerId,
  properties,
  canAdd,
  canEdit,
  defs,
}: {
  customerId: string;
  properties: PropertyView[];
  canAdd: boolean;
  canEdit: boolean;
  defs: CustomFieldDef[];
}) {
  const [editing, setEditingState] = useState<PropertyView | "new" | null>(
    null,
  );
  const [armed, setArmed] = useState(false);
  const setEditing = (v: PropertyView | "new" | null) => {
    if (v) setArmed(true);
    setEditingState(v);
  };
  return (
    <>
      <ListSection
        variant="title"
        header={
          properties.length > 1
            ? `Service addresses (${properties.length})`
            : "Service address"
        }
        footer={
          properties.some((p) => p.geocodeStatus === "failed")
            ? "We couldn't place one address on the map — check the street and ZIP."
            : undefined
        }
      >
        {properties.map((p) => (
          <ListRow
            key={p.id}
            icon={<MapPin size={17} />}
            iconTone={p.isPrimary ? "red" : "gray"}
            title={
              <span className="flex items-center gap-1.5">
                <span className="truncate">
                  {p.label ?? p.addressLine.split(",")[0]}
                </span>
                {p.isPrimary && properties.length > 1 && (
                  <Star
                    size={13}
                    className="shrink-0 fill-current text-warning"
                    aria-label="Primary"
                  />
                )}
                {p.hasGateCode && (
                  <KeyRound
                    size={13}
                    className="shrink-0 text-label-3"
                    aria-label="Has gate code"
                  />
                )}
              </span>
            }
            subtitle={
              p.label
                ? p.addressLine
                : p.addressLine.split(",").slice(1).join(",").trim()
            }
            onClick={canEdit ? () => setEditing(p) : undefined}
            accessory={canEdit ? "chevron" : "none"}
          />
        ))}
        {canAdd ? (
          <ListRow
            icon={<Plus size={17} />}
            iconStyle="tinted"
            title={<span className="text-accent-text">Add address</span>}
            onClick={() => setEditing("new")}
          />
        ) : null}
        {properties.length === 0 && !canAdd ? (
          <ListRow
            title={<span className="text-label-2">No service address yet</span>}
          />
        ) : null}
      </ListSection>
      {armed && (
        <PropertySheet
          customerId={customerId}
          property={editing}
          onClose={() => setEditing(null)}
          defs={defs}
          canDelete={canEdit && properties.length > 0}
        />
      )}
    </>
  );
}
