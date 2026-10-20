"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import type { EditableMember } from "./EditMemberSheet";

const load = () => import("./EditMemberSheet");
const EditMemberSheet = dynamic(load, { ssr: false });

/** The nav bar "Edit" button; the profile sheet's code loads on intent. */
export function EditMemberButton({
  member,
  skills,
}: {
  member: EditableMember;
  skills: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const preload = () => void load();
  return (
    <>
      <Button
        variant="plain"
        size="sm"
        onPointerEnter={preload}
        onPointerDown={preload}
        onFocus={preload}
        onClick={() => setOpen(true)}
      >
        Edit
      </Button>
      {open && (
        <EditMemberSheet
          member={member}
          skills={skills}
          onClosed={() => setOpen(false)}
        />
      )}
    </>
  );
}
