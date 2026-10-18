"use client";

import { Lock } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { toast } from "@/ui/components/Toast";
import { saveBankDetails } from "../actions";
import { isValidAba } from "../engine/aba";

/** Direct-deposit setup (payroll.bank_edit_own): ABA checksum here and on the server. */
export function BankForm({
  defaultHolder,
  authTitle,
  authBody,
}: {
  defaultHolder: string;
  authTitle: string;
  authBody: string;
}) {
  const [holderName, setHolder] = useState(defaultHolder);
  const [routing, setRouting] = useState("");
  const [account, setAccount] = useState("");
  const [accountConfirm, setConfirm] = useState("");
  const [accountType, setType] = useState<"checking" | "savings">("checking");
  const [holderType, setHolderType] = useState<"personal" | "business">(
    "personal",
  );
  const [authorize, setAuthorize] = useState(false);
  const [typedName, setTyped] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [pending, start] = useTransition();
  const routingError = useMemo(
    () =>
      routing.length === 9 && !isValidAba(routing)
        ? "That routing number isn't valid."
        : null,
    [routing],
  );
  const mismatch = accountConfirm.length > 0 && account !== accountConfirm;
  const ready =
    holderName.trim().length > 1 &&
    routing.length === 9 &&
    !routingError &&
    account.length >= 4 &&
    !mismatch &&
    authorize &&
    typedName.trim().length > 1;
  const err = (k: string) => errors?.[k]?.[0] ?? null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveBankDetails({
            holderName,
            routing,
            account,
            accountConfirm,
            accountType,
            holderType,
            authorize,
            typedName,
          });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? { routing: [r.error] });
            return;
          }
          setRouting("");
          setAccount("");
          setConfirm("");
          setTyped("");
          setAuthorize(false);
          setErrors(undefined);
          toast({
            title: "Bank details saved",
            message:
              "Your admin and you get a heads-up. Direct deposit resumes after a short safety hold.",
            tone: "success",
          });
        });
      }}
    >
      <TextField
        label="Account holder"
        autoComplete="name"
        value={holderName}
        onChange={(e) => setHolder(e.currentTarget.value)}
        error={err("holderName")}
      />
      <TextField
        label="Routing number"
        inputMode="numeric"
        autoComplete="off"
        maxLength={9}
        value={routing}
        onChange={(e) => setRouting(e.currentTarget.value.replace(/\D/g, ""))}
        error={routingError ?? err("routing")}
        hint="9 digits, bottom-left of a check"
      />
      <TextField
        label="Account number"
        inputMode="numeric"
        autoComplete="off"
        type="password"
        value={account}
        onChange={(e) => setAccount(e.currentTarget.value.replace(/\D/g, ""))}
        error={err("account")}
      />
      <TextField
        label="Account number again"
        inputMode="numeric"
        autoComplete="off"
        value={accountConfirm}
        onChange={(e) => setConfirm(e.currentTarget.value.replace(/\D/g, ""))}
        error={
          mismatch ? "The account numbers don't match." : err("accountConfirm")
        }
      />
      <SegmentedControl
        label="Account type"
        value={accountType}
        onChange={setType}
        segments={[
          { value: "checking", label: "Checking" },
          { value: "savings", label: "Savings" },
        ]}
      />
      <SegmentedControl
        label="Account owner"
        value={holderType}
        onChange={setHolderType}
        segments={[
          { value: "personal", label: "Personal" },
          { value: "business", label: "Business" },
        ]}
      />
      <section className="rounded-card bg-fill-2 p-4" aria-label={authTitle}>
        <p className="text-subhead font-semibold">{authTitle}</p>
        <p className="mt-1 whitespace-pre-line text-footnote text-label-2">
          {authBody}
        </p>
        <label className="mt-3 flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            checked={authorize}
            onChange={(e) => setAuthorize(e.currentTarget.checked)}
          />
          <span className="text-subhead">
            I authorize these direct deposits
          </span>
        </label>
        {err("authorize") && (
          <p className="text-footnote text-danger">{err("authorize")}</p>
        )}
        <TextField
          className="mt-2"
          label="Type your full name"
          value={typedName}
          onChange={(e) => setTyped(e.currentTarget.value)}
          error={err("typedName")}
        />
      </section>
      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={pending}
        disabled={!ready}
        icon={<Lock size={18} aria-hidden />}
      >
        Save bank details
      </Button>
      <p className="text-footnote text-label-2">
        Numbers are encrypted. Only the last 4 digits are ever shown. Anyone
        with payroll access gets an alert when they change, so a scammer
        can&apos;t quietly redirect your pay.
      </p>
    </form>
  );
}
