"use client";

import { MapPin, Plus, UserRound } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { AddressAutocomplete } from "@/ui/components/AddressAutocomplete";
import { Avatar } from "@/ui/components/Avatar";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { PhoneField } from "@/ui/components/PhoneField";
import { SearchField } from "@/ui/components/SearchField";
import { Sheet } from "@/ui/components/Sheet";
import { Spinner } from "@/ui/components/Spinner";
import { toast } from "@/ui/components/Toast";
import {
  getPickerCustomer,
  quickCreateCustomer,
  saveProperty,
  searchCustomersForPicker,
} from "./actions";
import type {
  CustomerPickerProps,
  DuplicateCandidate,
  PickerCustomer,
} from "./contracts";
import { parseAddressLine } from "./normalize";

// Client UI slot S3 (BUILD_PLAN §5.1). Lives inside the CONSUMER's <form>, so the
// sheet contains no <form> and no named inputs except the two hidden outputs:
// `${name}.customerId` and `${name}.propertyId`.

const stopEnter = (e: KeyboardEvent) => {
  if (e.key === "Enter") e.preventDefault();
};

/** S3 — Search + select customer and property (optional quick-create); emits hidden inputs. */
export function CustomerPicker({
  name = "customer",
  defaultCustomerId,
  defaultPropertyId,
  allowCreate = true,
  requireProperty = false,
  onChange,
}: CustomerPickerProps) {
  const [customer, setCustomer] = useState<PickerCustomer | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(
    defaultPropertyId ?? null,
  );
  const [open, setOpen] = useState(false);
  const [loadingDefault, setLoadingDefault] = useState(!!defaultCustomerId);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const select = useCallback(
    (c: PickerCustomer, preferProperty?: string | null) => {
      setCustomer(c);
      const pid =
        (preferProperty && c.properties.some((p) => p.id === preferProperty)
          ? preferProperty
          : c.properties[0]?.id) ?? null;
      setPropertyId(pid);
      onChangeRef.current?.({ customerId: c.id, propertyId: pid });
    },
    [],
  );

  useEffect(() => {
    if (!defaultCustomerId) return;
    let alive = true;
    getPickerCustomer(defaultCustomerId)
      .then((c) => {
        if (alive && c) select(c, defaultPropertyId);
      })
      .finally(() => alive && setLoadingDefault(false));
    return () => {
      alive = false;
    };
  }, [defaultCustomerId, defaultPropertyId, select]);

  const pickProperty = (pid: string) => {
    setPropertyId(pid);
    if (customer)
      onChangeRef.current?.({ customerId: customer.id, propertyId: pid });
  };

  return (
    <div>
      <input
        type="hidden"
        name={`${name}.customerId`}
        value={customer?.id ?? ""}
      />
      <input
        type="hidden"
        name={`${name}.propertyId`}
        value={propertyId ?? ""}
      />
      <ListSection header="Customer">
        {loadingDefault ? (
          <div className="flex min-h-11 items-center gap-3 px-4">
            <Spinner size={18} /> <span className="text-label-2">Loading…</span>
          </div>
        ) : customer ? (
          <ListRow
            leading={
              <Avatar
                name={customer.displayName}
                seed={customer.id}
                size={34}
              />
            }
            title={customer.displayName}
            subtitle={customer.subtitle}
            detail="Change"
            onClick={() => setOpen(true)}
          />
        ) : (
          <ListRow
            icon={<UserRound size={17} />}
            title={<span className="text-accent-text">Choose a customer</span>}
            onClick={() => setOpen(true)}
          />
        )}
        {customer?.properties.map((p) => (
          <ListRow
            key={p.id}
            icon={<MapPin size={17} />}
            iconTone="red"
            iconStyle="tinted"
            title={p.addressLine}
            subtitle={p.label ?? undefined}
            accessory={propertyId === p.id ? "check" : "none"}
            onClick={() => pickProperty(p.id)}
            multiline
          />
        ))}
        {customer && (
          <AddAddressRow
            customerId={customer.id}
            required={requireProperty && customer.properties.length === 0}
            onAdded={async (pid) => {
              const fresh = await getPickerCustomer(customer.id);
              if (fresh) select(fresh, pid);
            }}
          />
        )}
      </ListSection>
      <PickerSheet
        open={open}
        onOpenChange={setOpen}
        allowCreate={allowCreate}
        onPick={(c) => {
          select(c);
          setOpen(false);
        }}
      />
    </div>
  );
}

function AddAddressRow({
  customerId,
  required,
  onAdded,
}: {
  customerId: string;
  required: boolean;
  onAdded: (propertyId: string) => void;
}) {
  const [editing, setEditing] = useState(required);
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setEditing(required), [required]);
  if (!editing)
    return (
      <ListRow
        icon={<Plus size={17} />}
        iconStyle="tinted"
        title={<span className="text-accent-text">Add an address</span>}
        onClick={() => setEditing(true)}
      />
    );
  const save = () =>
    start(async () => {
      const a = parseAddressLine(line);
      if (!a || !a.city || !a.state) {
        setError("Use “Street, City, ST 12345”.");
        return;
      }
      const r = await saveProperty({
        customerId,
        street: a.street,
        unit: a.unit ?? undefined,
        city: a.city,
        state: a.state,
        zip: a.zip,
        isPrimary: false,
        keepGateCode: false,
      });
      if (!r.ok || !r.data) {
        setError(r.ok ? "Couldn't save" : r.error);
        return;
      }
      setLine("");
      setError(null);
      setEditing(false);
      onAdded(r.data.propertyId);
    });
  return (
    <div className="flex items-start gap-2 px-4 py-3">
      <AddressAutocomplete
        label={required ? "Service address (required)" : "New service address"}
        placeholder="12 Oak St, Austin, TX 78701"
        value={line}
        pick="label"
        onChange={(e) => setLine(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        error={error}
        className="flex-1"
      />
      {/* Centered on the 44 px field under its label (18 px line + 6 px gap), so
          suggestions or an error under the field don't move it. */}
      <Button
        size="sm"
        onClick={save}
        loading={pending}
        disabled={!line.trim()}
        className="mt-[29px] shrink-0"
      >
        Add
      </Button>
    </div>
  );
}

function PickerSheet({
  open,
  onOpenChange,
  allowCreate,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  allowCreate: boolean;
  onPick: (c: PickerCustomer) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickerCustomer[] | null>(null);
  const [mode, setMode] = useState<"search" | "create">("search");
  const seq = useRef(0);

  const run = useCallback(async (query: string) => {
    const n = ++seq.current;
    const res = await searchCustomersForPicker(query).catch(() => []);
    if (n === seq.current) setResults(res);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh only when the sheet opens
  useEffect(() => {
    if (open) {
      setMode("search");
      void run(q);
    }
  }, [open]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "create" ? "New customer" : "Choose customer"}
      detents={["large"]}
      leading={
        <Button
          variant="plain"
          size="sm"
          onClick={() =>
            mode === "create" ? setMode("search") : onOpenChange(false)
          }
        >
          {mode === "create" ? "Back" : "Cancel"}
        </Button>
      }
    >
      {mode === "create" ? (
        <QuickCreate
          initialName={/\d/.test(q) ? "" : q}
          initialPhone={/\d{3}/.test(q) ? q : ""}
          onCreated={onPick}
        />
      ) : (
        <div className="flex flex-col gap-4 pb-6">
          <SearchField
            placeholder="Name, phone, email or street"
            onSearch={(v) => {
              setQ(v);
              void run(v);
            }}
            showCancel={false}
            autoFocus
          />
          {results == null ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <ListSection
              header={q ? "Matches" : "Recent"}
              footer={
                results.length === 0
                  ? q
                    ? `No customers match “${q}”.`
                    : "No customers yet."
                  : undefined
              }
            >
              {allowCreate ? (
                <ListRow
                  icon={<Plus size={17} />}
                  title={
                    <span className="text-accent-text">
                      {q && !/\d{3}/.test(q)
                        ? `New customer “${q}”`
                        : "New customer"}
                    </span>
                  }
                  onClick={() => setMode("create")}
                />
              ) : null}
              {results.map((c) => (
                <ListRow
                  key={c.id}
                  leading={
                    <Avatar name={c.displayName} seed={c.id} size={34} />
                  }
                  title={c.displayName}
                  subtitle={
                    c.properties[0]
                      ? `${c.subtitle} · ${c.properties[0].addressLine}`
                      : c.subtitle
                  }
                  onClick={() => onPick(c)}
                  accessory="none"
                />
              ))}
            </ListSection>
          )}
        </div>
      )}
    </Sheet>
  );
}

function QuickCreate({
  initialName,
  initialPhone,
  onCreated,
}: {
  initialName: string;
  initialPhone: string;
  onCreated: (c: PickerCustomer) => void;
}) {
  const [nameV, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [dups, setDups] = useState<DuplicateCandidate[]>([]);
  const [pending, start] = useTransition();

  const submit = (force: boolean) =>
    start(async () => {
      const r = await quickCreateCustomer({
        name: nameV,
        phone,
        email,
        address,
        force,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? { _: [r.error] });
        return;
      }
      setErrors({});
      if (r.data?.duplicates.length) {
        setDups(r.data.duplicates);
        return;
      }
      if (r.data?.customerId) {
        const c = await getPickerCustomer(r.data.customerId);
        if (c) {
          toast.success("Customer added");
          onCreated(c);
        }
      }
    });

  const pickExisting = async (id: string) => {
    const c = await getPickerCustomer(id);
    if (c) onCreated(c);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: swallows Enter so the host page's form isn't submitted
    <div className="flex flex-col gap-4 pb-6" onKeyDown={stopEnter}>
      {dups.length > 0 && (
        <ListSection
          header="Possible duplicates"
          footer="Same phone, email or address. Use the existing customer to keep history in one place."
        >
          {dups.map((d) => (
            <ListRow
              key={d.id}
              leading={<Avatar name={d.displayName} seed={d.id} size={34} />}
              title={d.displayName}
              subtitle={[d.phoneDisplay, d.email, d.addressShort]
                .filter(Boolean)
                .join(" · ")}
              detail="Use"
              onClick={() => pickExisting(d.id)}
            />
          ))}
        </ListSection>
      )}
      <TextField
        label="Name"
        value={nameV}
        autoComplete="name"
        onChange={(e) => setName(e.currentTarget.value)}
        error={errors.name}
        autoFocus
      />
      <PhoneField
        label="Mobile phone"
        value={phone}
        onValueChange={setPhone}
        error={errors.phone}
      />
      <TextField
        label="Email"
        type="email"
        value={email}
        autoComplete="email"
        onChange={(e) => setEmail(e.currentTarget.value)}
        error={errors.email}
      />
      <AddressAutocomplete
        label="Service address"
        placeholder="12 Oak St, Austin, TX 78701"
        value={address}
        pick="label"
        onChange={(e) => setAddress(e.currentTarget.value)}
        error={errors.address}
        hint="Optional — you can add it later."
      />
      {errors._ && (
        <p className="text-footnote text-danger">{errors._.join(" ")}</p>
      )}
      <Button
        size="lg"
        fullWidth
        loading={pending}
        disabled={!nameV.trim()}
        onClick={() => submit(dups.length > 0)}
      >
        {dups.length > 0 ? "Create anyway" : "Add customer"}
      </Button>
    </div>
  );
}
