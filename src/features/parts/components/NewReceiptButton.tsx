"use client";

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/ui/components/Button";

const load = () => import("./ReceiptSheet");
const ReceiptSheet = dynamic(load, { ssr: false });

/** "New receipt" (/parts?new=receipt). The sheet's code loads on intent / first open. */
export function NewReceiptButton({
  defaultOpen = false,
  trigger = true,
  jobs,
  vehicles,
}: {
  defaultOpen?: boolean;
  /**
   * false = no button of its own: the sheet opens from the header "+" menu
   * ("Upload receipt" → ?new=receipt), so the header has one "+" (QA T4-11).
   */
  trigger?: boolean;
  jobs: { id: string; label: string }[];
  vehicles: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(defaultOpen);
  const [armed, setArmed] = useState(defaultOpen);
  const wantsNew = params.get("new") === "receipt";
  useEffect(() => {
    if (wantsNew) {
      setArmed(true);
      setOpen(true);
    }
  }, [wantsNew]);
  const close = (o: boolean) => {
    setOpen(o);
    if (!o && params.get("new")) {
      const next = new URLSearchParams(params.toString());
      next.delete("new");
      router.replace(next.size ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    }
  };
  const preload = () => void load();
  return (
    <>
      {trigger && (
        <Button
          size="sm"
          variant="tinted"
          icon={<Plus size={17} aria-hidden />}
          onPointerEnter={preload}
          onPointerDown={preload}
          onFocus={preload}
          onClick={() => {
            setArmed(true);
            setOpen(true);
          }}
        >
          Receipt
        </Button>
      )}
      {armed && (
        <ReceiptSheet
          open={open}
          onOpenChange={close}
          jobs={jobs}
          vehicles={vehicles}
        />
      )}
    </>
  );
}
