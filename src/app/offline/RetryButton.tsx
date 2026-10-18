"use client";

import { Button } from "@/ui/components/Button";

export function RetryButton() {
  return (
    <Button className="mt-6" onClick={() => window.location.reload()}>
      Try again
    </Button>
  );
}
