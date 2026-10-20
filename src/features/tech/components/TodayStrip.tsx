import "server-only";
import { Banknote, CircleCheck, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getCustodyBalances, getDayEarnings } from "@/features/payroll/api";
import { isEnabled } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import { MoneyText } from "@/ui/components/MoneyText";
import { cx } from "@/ui/cx";

function Tile({
  icon,
  label,
  value,
  foot,
  href,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  href?: string;
  tone?: "warn";
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-footnote font-medium text-label-2 [&_svg]:shrink-0">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cx(
          "num mt-1 block whitespace-nowrap text-title3 font-bold",
          tone === "warn" ? "text-warning" : "text-label",
        )}
      >
        {value}
      </span>
      {foot && (
        <span className="mt-0.5 block truncate text-caption text-label-2">
          {foot}
        </span>
      )}
    </>
  );
  const cls =
    "card block min-w-[112px] flex-1 snap-start px-3.5 py-3 outline-offset-2";
  return href ? (
    <Link
      href={href}
      transitionTypes={["nav-forward"]}
      className={cx(cls, "pressable hover-lift")}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * Today's summary strip (DESIGN.md §7.1): jobs done, earned today and cash held
 * (tap to hand in). Scrolls sideways on narrow phones; pay tiles only with payroll
 * on and the viewer's own pay permission.
 */
export async function TodayStrip({
  user,
  done,
  total,
}: {
  user: SessionUser;
  done: number;
  total: number;
}) {
  const payroll = await isEnabled("payroll");
  const showEarned = payroll && user.perms.has("payroll.view_own");
  const [earned, custody] = await Promise.all([
    showEarned ? getDayEarnings(user.id).catch(() => null) : null,
    payroll
      ? getCustodyBalances([user.id]).catch(() => ({}) as Record<string, never>)
      : null,
  ]);
  const held = custody?.[user.id]?.heldCents ?? 0;
  const days = custody?.[user.id]?.oldestAt
    ? Math.floor(
        (Date.now() - (custody[user.id]?.oldestAt?.getTime() ?? 0)) /
          86_400_000,
      )
    : 0;
  return (
    <section
      aria-label="Today so far"
      className="-mx-[var(--gutter,16px)] flex snap-x scroll-px-[var(--gutter,16px)] gap-2 overflow-x-auto px-[var(--gutter,16px)] [scrollbar-width:none] md:mx-0 md:px-0"
    >
      <Tile
        icon={<CircleCheck size={14} aria-hidden />}
        label="Jobs done"
        value={
          <>
            {done}
            <span className="text-label-2 font-semibold">/{total}</span>
          </>
        }
        foot={
          total === 0
            ? "None today"
            : done === total
              ? "All done"
              : `${total - done} to go`
        }
      />
      {earned != null && (
        <Tile
          icon={<Wallet size={14} aria-hidden />}
          label="Earned"
          value={<MoneyText cents={earned} />}
          foot="Today"
          href="/pay"
        />
      )}
      {custody != null && (
        <Tile
          icon={<Banknote size={14} aria-hidden />}
          label="Cash held"
          value={<MoneyText cents={held} />}
          foot={held > 0 ? "Tap to hand in" : "Nothing to hand in"}
          href={held > 0 ? "/pay#cash" : undefined}
          tone={held > 0 && days > 3 ? "warn" : undefined}
        />
      )}
    </section>
  );
}
