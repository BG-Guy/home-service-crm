import { formatBps, formatMoney } from "@/lib/money";
import { formatDateKey, formatDateTime } from "@/lib/time";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { ListRow, ListSection } from "@/ui/components/List";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import type { getStatement } from "../queries";
import { LEDGER_TYPE_LABEL } from "../queries";
import { PAYOUT_METHOD_LABEL } from "../server/payouts";
import { AcknowledgeStatement, FlagLineButton } from "./PayActions";
import { ReviewEntryButtons } from "./SettlementAdmin";
import { WhyAmount } from "./WhyAmount";

type Statement = Awaited<ReturnType<typeof getStatement>>;

const m = (c: number) => formatMoney(c);
const hours = (minutes: number) => {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} hour${h === 1 ? "" : "s"}`;
};
const signed = (c: number) => (c > 0 ? `+${m(c)}` : m(c));
const METHOD: Record<string, string> = {
  card: "Card",
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  venmo: "Venmo",
  ach: "ACH",
  other: "Other",
};

/** Pay stub / statement (SPEC M16): printable; used by /pay/statements/[id] and /pay/settlements/[id]. */
export function StatementView({
  st,
  companyName,
  tz,
  admin,
}: {
  st: Statement;
  companyName: string;
  tz: string;
  admin: boolean;
}) {
  const inReview = st.status === "tech_review" || st.status === "draft";
  const canFlag = st.viewerIsOwner && inReview;
  const t = st.totals;
  const reimb = st.otherLines.filter((l) => l.wageClass === "reimbursement");
  const other = st.otherLines.filter((l) => l.wageClass !== "reimbursement");
  const jobsNet = st.jobLines.reduce((a, j) => a + j.postedCents, 0);
  // W-2 top-ups and the tier adjustment are posted on approval (QA T3-01): show
  // them while the statement is still in review so the total isn't a surprise.
  const preview = t.preview;
  const previewTotal = preview
    ? preview.guaranteeTopupCents +
      preview.otTopupCents +
      preview.tierAdjustmentCents
    : 0;

  return (
    <article className="statement flex flex-col gap-[var(--section-gap)] print:gap-4">
      <header className="list-card flex flex-col gap-3 p-4 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-footnote font-medium text-label-2">
              {companyName} · Pay statement
            </p>
            <h2 className="text-title2 font-semibold">{st.tech.name}</h2>
            <p className="text-subhead text-label-2">
              {formatDateKey(st.period.startsOn)} –{" "}
              {formatDateKey(st.period.endsOn)} ·{" "}
              {st.tech.workerType === "w2" ? "W-2 employee" : "1099 contractor"}
              {st.plan ? ` · ${st.plan.name} v${st.plan.version}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:flex-col sm:items-end">
            <StatusPill kind="settlement" status={st.status} />
            {st.settlement.techAckAt ? (
              <span className="text-footnote text-label-2">
                Acknowledged {formatDateTime(st.settlement.techAckAt, tz)}
              </span>
            ) : (
              <Pill size="sm" tone="gray">
                Not acknowledged
              </Pill>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Carried in" value={m(st.openingCents)} />
          <Figure label="This period" value={signed(st.periodNetCents)} />
          <Figure
            label={st.closingCents < 0 ? "You owe" : "Total due"}
            value={m(Math.abs(st.closingCents))}
            strong
            tone={st.closingCents < 0 ? "red" : undefined}
          />
          <Figure label="Paid" value={m(st.paidCents)} />
        </div>
        {st.closingCents < 0 && (
          <p className="text-footnote text-label-2">
            Cash you kept was more than you earned. The balance carries into
            your next statement.
          </p>
        )}
      </header>

      <ListSection
        header={`Jobs (${st.jobLines.length})`}
        footer={
          st.jobLines.length ? `Jobs total ${signed(jobsNet)}` : undefined
        }
      >
        {st.jobLines.length === 0 ? (
          <ListRow title="No jobs on this statement" />
        ) : (
          st.jobLines.map((j) => (
            <ListRow
              key={j.jobId}
              multiline
              title={
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{j.jobNumber}</span>
                  <span className="text-subhead text-label-2">
                    {j.completedAt
                      ? formatDateTime(j.completedAt, tz).split(",")[0]
                      : ""}
                    {j.city ? ` · ${j.city}` : ""}
                  </span>
                </span>
              }
              subtitle={
                <span className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-footnote sm:grid-cols-4">
                  <span>
                    Total {m(j.totalCents)}
                    {j.methods.length
                      ? ` · ${j.methods.map((x) => METHOD[x] ?? x).join(", ")}`
                      : ""}
                  </span>
                  <span>
                    Fee {m(j.feesCents)} · Parts {m(j.companyPartsCents)}/
                    {m(j.techPartsCents)}
                  </span>
                  <span>
                    Base {m(j.baseCents)} × {formatBps(j.rateBps)}
                    {j.splitBps && j.splitBps !== 10000
                      ? ` · split ${formatBps(j.splitBps)}`
                      : ""}
                  </span>
                  <span>
                    Comm {m(j.commissionCents)}
                    {j.tipCents ? ` · tip ${m(j.tipCents)}` : ""}
                    {j.cashHeldCents ? ` · cash ${m(j.cashHeldCents)}` : ""}
                  </span>
                </span>
              }
              detail={
                <span className="flex flex-col items-end gap-0.5">
                  <WhyAmount
                    title={`${j.jobNumber}: why ${m(j.postedCents)}?`}
                    steps={j.trace}
                    footnote={
                      j.postedCents !== j.netCents
                        ? "Some of this job's lines landed on another statement (e.g. a later adjustment)."
                        : undefined
                    }
                  >
                    <span className="num font-semibold">
                      {signed(j.postedCents)}
                    </span>
                  </WhyAmount>
                  {j.pendingReimbursement && (
                    <Pill size="sm" tone="orange">
                      Receipt pending
                    </Pill>
                  )}
                  {canFlag && (
                    <FlagLineButton
                      settlementId={st.settlement.id}
                      what={`${j.jobNumber} (${m(j.postedCents)})`}
                      ledgerEntryId={null}
                    />
                  )}
                </span>
              }
            />
          ))
        )}
      </ListSection>

      {reimb.length > 0 && (
        <ListSection
          header="Reimbursements"
          footer="Reimbursements are not wages."
        >
          {reimb.map((l) => (
            <LedgerRow
              key={l.id}
              l={l}
              canFlag={canFlag}
              settlementId={st.settlement.id}
            />
          ))}
        </ListSection>
      )}
      {other.length > 0 && (
        <ListSection header="Adjustments, cash & chargebacks">
          {other.map((l) => (
            <LedgerRow
              key={l.id}
              l={l}
              canFlag={canFlag}
              settlementId={st.settlement.id}
            />
          ))}
        </ListSection>
      )}
      {inReview && preview && previewTotal !== 0 && (
        <ListSection
          header="Added when approved"
          footer={`Calculated from ${hours(preview.minutes)} clocked this period. These lines are posted to this statement when it's approved.`}
        >
          {preview.guaranteeTopupCents !== 0 && (
            <ListRow
              title="Minimum-wage top-up"
              detail={
                <span className="num">
                  {signed(preview.guaranteeTopupCents)}
                </span>
              }
            />
          )}
          {preview.otTopupCents !== 0 && (
            <ListRow
              title="Overtime premium"
              detail={
                <span className="num">{signed(preview.otTopupCents)}</span>
              }
            />
          )}
          {preview.tierAdjustmentCents !== 0 && (
            <ListRow
              title="Tier commission adjustment"
              detail={
                <span className="num">
                  {signed(preview.tierAdjustmentCents)}
                </span>
              }
            />
          )}
        </ListSection>
      )}
      {st.pendingLines.length > 0 && (
        <ListSection
          header="Waiting for review ⚖️"
          footer="W-2 deductions are never applied automatically. They count only after an admin applies them."
        >
          {st.pendingLines.map((l) => (
            <ListRow
              key={l.id}
              title={l.memo ?? LEDGER_TYPE_LABEL[l.type] ?? l.type}
              subtitle={`${LEDGER_TYPE_LABEL[l.type] ?? l.type} · ${formatDateKey(l.effectiveDate)}`}
              detail={
                <span className="flex items-center gap-2">
                  <span className="num">{signed(l.amountCents)}</span>
                  {admin && (
                    <span className="print:hidden">
                      <ReviewEntryButtons ledgerEntryId={l.id} />
                    </span>
                  )}
                </span>
              }
            />
          ))}
        </ListSection>
      )}

      {st.payouts.length > 0 && (
        <ListSection header="Payments">
          {st.payouts.map((p) => (
            <ListRow
              key={p.id}
              title={`Paid by ${PAYOUT_METHOD_LABEL[p.method] ?? p.method}`}
              subtitle={`${formatDateKey(p.paidOn)}${p.reference ? ` · ${p.reference}` : ""}`}
              detail={<span className="num">{m(p.allocatedCents)}</span>}
            />
          ))}
        </ListSection>
      )}

      <ListSection
        header="Totals"
        footer="Wages are commission, tips, spiffs, minimum-wage and overtime top-ups, and adjustments."
      >
        <KeyValueList
          items={[
            {
              label: "Wages",
              value: m(t.wagesCents ?? 0),
              numeric: true,
            },
            {
              label: "Reimbursements",
              value: m(t.reimbursementsCents ?? 0),
              numeric: true,
            },
            {
              label: "Cash netted / handed in",
              value: m(t.custodyCents ?? 0),
              numeric: true,
            },
            ...((t.otherCents ?? 0)
              ? [
                  {
                    label: "Carried forward",
                    value: m(t.otherCents ?? 0),
                    numeric: true,
                  },
                ]
              : []),
            {
              label: `Year to date: wages`,
              value: m(st.ytd.wagesCents),
              numeric: true,
            },
            {
              label: `Year to date: reimbursements`,
              value: m(st.ytd.reimbursementsCents),
              numeric: true,
            },
            {
              label: `Year to date: paid`,
              value: m(st.ytd.paidCents),
              numeric: true,
            },
          ]}
        />
      </ListSection>

      {st.flags.length > 0 && (
        <ListSection header="Flags">
          {st.flags.map((f) => (
            <ListRow
              key={f.id}
              multiline
              title={f.comment}
              subtitle={
                f.resolution
                  ? `Answer: ${f.resolution}`
                  : formatDateTime(f.createdAt, tz)
              }
              detail={
                <StatusPill kind="settlementFlag" status={f.status} size="sm" />
              }
            />
          ))}
        </ListSection>
      )}

      {st.viewerIsOwner &&
        !st.settlement.techAckAt &&
        st.status !== "draft" && (
          <section
            className="list-card p-4 print:hidden"
            aria-label="Acknowledge"
          >
            <AcknowledgeStatement
              settlementId={st.settlement.id}
              defaultName=""
            />
            {canFlag && (
              <div className="mt-2 flex justify-center">
                <FlagLineButton
                  settlementId={st.settlement.id}
                  what="Something else on this statement"
                />
              </div>
            )}
          </section>
        )}
      {st.settlement.techAckAt && (
        <p className="px-4 text-footnote text-label-2">
          Acknowledged by {st.settlement.techAckName} on{" "}
          {formatDateTime(st.settlement.techAckAt, tz)}
          {st.settlement.techAckIp ? ` from ${st.settlement.techAckIp}` : ""}.
        </p>
      )}
    </article>
  );
}

function Figure({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "red";
}) {
  return (
    <div className="rounded-card bg-fill-2 px-3 py-2">
      <p className="text-footnote text-label-2">{label}</p>
      <p
        className={`num ${strong ? "text-title3 font-semibold" : "text-headline"} ${tone === "red" ? "text-danger" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function LedgerRow({
  l,
  canFlag,
  settlementId,
}: {
  l: Statement["otherLines"][number];
  canFlag: boolean;
  settlementId: string;
}) {
  return (
    <ListRow
      title={l.memo ?? LEDGER_TYPE_LABEL[l.type] ?? l.type}
      subtitle={`${LEDGER_TYPE_LABEL[l.type] ?? l.type} · ${formatDateKey(l.effectiveDate)}${l.jobNumber ? ` · ${l.jobNumber}` : ""}`}
      detail={
        <span className="flex items-center gap-1">
          <span className={`num ${l.amountCents < 0 ? "text-danger" : ""}`}>
            {signed(l.amountCents)}
          </span>
          {canFlag && (
            <FlagLineButton
              settlementId={settlementId}
              ledgerEntryId={l.id}
              what={`${l.memo ?? l.type} (${signed(l.amountCents)})`}
            />
          )}
        </span>
      }
    />
  );
}
