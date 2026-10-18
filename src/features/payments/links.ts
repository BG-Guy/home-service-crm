// Where a payment or refund row leads (pure, client-safe): the job's invoice tab,
// else the invoice, else the customer, each only when the viewer may open it.

export interface PaymentLinkTarget {
  jobId: string | null;
  invoiceId: string | null;
  customerId: string | null;
}

export interface PaymentLinkAccess {
  jobs: boolean;
  invoices: boolean;
  customers: boolean;
}

/**
 * What a viewer of everyone's payments (/payments, a customer's payment history)
 * may open. Rows aren't limited to the viewer's own jobs, so this asks for the
 * company-wide permissions: an invoice without `jobs.view_all` opens only for an
 * assignee of its job.
 */
export function paymentLinkAccess(perms: {
  has(perm: string): boolean;
}): PaymentLinkAccess {
  const allJobs = perms.has("jobs.view_all");
  return {
    jobs: allJobs,
    invoices: allJobs && perms.has("invoices.view"),
    customers: perms.has("customers.view_all"),
  };
}

export function paymentHref(
  p: PaymentLinkTarget,
  can: PaymentLinkAccess,
): string | null {
  if (p.jobId && can.jobs) return `/jobs/${p.jobId}?tab=invoice`;
  if (p.invoiceId && can.invoices) return `/invoices/${p.invoiceId}`;
  if (p.customerId && can.customers) return `/customers/${p.customerId}`;
  return null;
}
