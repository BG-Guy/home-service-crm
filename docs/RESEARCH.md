# Research Digest: Home-Service CRM Boilerplate

Compiled 2026-10-14 from five research passes: pain points, payments and chargebacks, pay operations, messaging and leads, and stack and design. This file is the evidence base for `docs/SPEC.md`. When the spec and this file disagree, the spec wins. This file explains *why*.

**Limits on the research**
- Reddit, Capterra and G2 blocked every fetch. Firsthand evidence therefore comes from Trustpilot, vendor help docs, community forums, trade press, regulators, Stripe/Square docs and statutes.
- Vendor statistics are marked *(vendor, directional)*.
- Items marked ⚖️ are legal rules. **This is not legal advice.** The product ships them as admin-configurable warnings, never as hard-coded legal logic.
- Items marked **[unverified]** were not re-confirmed when the search budget ran out.

---

## 1. Top problems in home services (ranked)

| # | Problem | Who suffers | Fix in a lightweight CRM | Effort |
|---|---|---|---|---|
| 1 | Slow or missed lead response | Owner, customer | Lead webhook, auto-acknowledge in 60 s, speed-to-lead timer, escalation | Quick win |
| 2 | Customer doesn't know when the tech arrives | Customer, office | Status pipeline, "On my way" text with tech card and ETA, confirm/reschedule replies | Quick win |
| 3 | Tech theft: cash skimming, side jobs, customer poaching | Owner | Immutable job numbers, cancel audit, customer-confirmed receipts, masked contact info, anomaly report | Medium |
| 4 | Price surprise / bait-and-switch reputation (locksmith, garage door) | Customer, honest businesses | Signed estimate before work, change-order re-approval, license # on documents | Quick win |
| 5 | Unpaid invoices | Owner, office | Pay on site (QR/link), dunning sequence, aging report | Quick win |
| 6 | Chargebacks and friendly fraud | Owner | Evidence capture during the job, auto evidence pack, prevention rules | Medium |
| 7 | Commission and settlement disputes | Tech, owner | Configurable formula, per-job calculation trace, weekly ledger, tech e-acknowledgment | Medium |
| 8 | Estimates nobody follows up | Owner | Automatic follow-up sequence, good/better/best options, expiry dates | Quick win |
| 9 | No-shows and late cancellations | Tech, owner | 24 h and morning-of reminders with C/R replies, cancellation policy at booking | Quick win |
| 10 | Too few reviews | Owner | Request 1–2 h after completion, SMS first, no gating, click tracking | Quick win |
| 11 | Parts leakage (bought but never billed, no receipts) | Owner, tech | Two-path parts ledger, receipt photos, "unbilled part" flag | Medium |
| 12 | Untracked callbacks and warranty work | Owner | `callback_of` link, reason code, callback rate per tech | Quick win |
| 13 | Bloated, locked-in, per-seat software | Owner | Full export, no per-seat logic, every module a free feature flag | Architecture |
| 14 | Poor mobile app, no offline mode | Tech | PWA, IndexedDB outbox, autosave, photo upload queue | Heavier |
| 15 | SMS cost and compliance | Owner | Free `sms:` deep links now, paid provider adapter later, consent ledger | Quick win / later |
| 16 | Missing trade-specific fields | Owner | JSONB custom fields and checklists per service type | Medium |
| 17 | Tool theft, vehicle maintenance gaps | Owner, tech | Tool register (serial, photo), odometer and oil logs, reminders | Quick win |

### 1.1 Evidence behind each problem

**P1. Lead response**
- HBR studied 2,241 firms. Average response took 42 h, 23% never responded, and replying within 1 h made qualifying the lead about 7× more likely ([HBR 2011](https://hbr.org/2011/03/the-short-life-of-online-sales-leads)).
- One audit of 466 home-service firms found 95% did not respond within 5 minutes ([SalesAi](https://salesai.com/blog/speed-to-lead)).
- The "78% hire the first responder" figure has weak provenance. Don't cite it in product copy.
- Shared-lead marketplaces send one request to 3–10 contractors ([PipelineOn](https://pipelineon.com/blog/thumbtack-alternative/)). Owners pay $10–85 per lead ([Valley Marketing](https://thevalleymarketinggroup.com/blog/angi-vs-thumbtack-vs-google-lsa-contractors-2026/)).
- Google LSA ranking depends partly on responsiveness ([Google](https://support.google.com/localservices/answer/7527305)).
- Missed-call rates range from 14% to about 48%, depending on definition ([summary](https://salesai.com/blog/missed-call-statistics)).

**P2. Arrival communication**
- J.D. Power found that customers contacted before arrival scored 138 points higher, and 1-hour windows scored 49 points above 2-hour windows ([JD Power](https://www.jdpower.com/business/press-releases/us-telecom-home-service-technician-study), [Lightwave](https://www.lightwaveonline.com/broadband/article/55024839/jd-power-ties-service-windows-to-sub-satisfaction)).
- Homeowners rank communication and scheduling (38%) above price (21%) as their top frustration ([FIELDBOSS via Barchart](https://www.barchart.com/story/news/34752666/bad-communication-not-high-prices-is-the-real-problem-in-hvac-industry-new-survey-reveals)).
- A Housecall Pro user complained that tapping "On my way" for the next job stopped the timer on the current job. **Do not couple state across jobs** ([fieldservicesoftware.io](https://fieldservicesoftware.io/comparisons/housecall-pro-vs-jobber/)).
- Jobber users complain that texts don't appear in the client record. **One customer timeline** is needed ([followupcrm](https://www.followupcrm.com/blog/housecall-pro-vs-jobber-1)).

**P3. Tech theft**
- Documented schemes: under-reporting cash, overcharging and pocketing the difference, marking a job "cancelled" then doing it for cash, running cards on a personal Square, and taking customer lists on departure ([HVACR Business](https://www.hvacrbusiness.com/news/2021/aug/31/easy-way-technician-can-steal), [Contractor Mag](https://www.contractormag.com/management/article/20874501/how-to-detect-and-prevent-employee-fraud), [FieldPromax](https://fieldpromax.com/blog/prevent-field-service-technicians-from-stealing)).
- A Florida locksmith affidavit describes 50/50 and 60/40 splits, with techs mailing the company's cut as money orders ([blumenthals.com](https://blumenthals.com/blog/wp-json/wp/v2/posts/5143)).
- **The strongest cheap control** is an automatic company receipt to the customer for every payment, cash included: "You paid $X cash to {tech} for job #123. Wrong amount? Reply."
- Workiz sells call masking as a paid feature ([Workiz help](https://help.workiz.com/en/articles/4341994-setting-up-call-masking-to-monitor-your-field-techs)). Our free equivalent is a `customers.contact_view` permission, off for techs, with the full number revealed only during the active job window.
- Scam operators ask customers to write checks to individuals ([KTVU](https://www.ktvu.com/news/2-investigates-undercover-video-raises-questions-about-garage-door-repair-company)). Every document says "Pay only {Company}."

**P4. Price surprise**
- A locksmith quoted under $400 and billed $578. Another quoted $150 and billed over $2,000 ([Live 5, Jun 2026](https://www.live5news.com/2026/06/25/locked-out-overcharged-customers-detail-complaints-against-charleston-locksmith-company/)).
- The BBB warned about garage-door scams in 2026 ([WBAY](https://www.wbay.com/2026/03/03/bbb-warns-homeowners-garage-door-repair-scams/)), and the CT DCP issued a call for complaints in 2025 ([CT DCP](https://portal.ct.gov/dcp/news-releases-from-the-department-of-consumer-protection/2025-news-releases/department-of-consumer-protection-calls-for-complaints-regarding-garage-door-services)).
- ⚖️ California requires the service-call charge to be quoted before the visit ([CA BHGS](https://bhgs.dca.ca.gov/consumers/bear_faq.shtml)).
- Locksmith ownership verification: photo of ID, proof of address or registration, and a signed authority statement ([Locksmith Ledger](https://www.locksmithledger.com/home/article/53067928/cover-your-assets), [Acme](https://www.acmelocksmith.com/articles/verification-of-ownership/)).

**P5. Getting paid**
- Invoices take an average of 2.6 reminders before payment *(secondary)* ([Telleroo](https://www.telleroo.com/blog/late-payers-3-ways-ar-automation-will-help)).
- ⚖️ Mechanics-lien windows can be as short as 2–4 months ([Levelset](https://www.levelset.com/payment-help/topic/mechanics-lien/)).

**P8. Estimate follow-up**
- Close rates run about 30–60% *(vendor)* ([Chiirp](https://chiirp.com/insider_information_blog/estimate-rehash-playbook), [PipelineOn](https://pipelineon.com/blog/unsold-estimates-workiz-follow-up/)).
- ServiceTitan price-book users saw 14% average-ticket growth against 8% for others ([ServiceTitan](https://www.servicetitan.com/coronavirus/pricebook-pro-users-seeing-stronger-ticket-sizes-in-2020)).

**P9. No-shows**
- A 21-study meta-analysis (mostly medical) found about a 25% relative reduction from reminders ([Entagl](https://www.entagl.com/blog/reduce-no-shows-reminders-confirmation-calls)).
- One A/B test cut no-shows from 21.1% to 14.2% through wording alone ([PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7310733/)).
- Housecall Pro suggests a one-time cancellation-fee waiver for loyal customers ([HCP](https://www.housecallpro.com/learn/last-minute-cancellations/)).

**P11. Parts leakage**
- Shrinkage runs 1.6–3% of revenue *(vendor)* ([Ascora](https://www.ascora.io/Blog/the-10000-leak-why-poor-inventory-control-is)).
- Warranty-claim filing windows are often 30–90 days *(vendor)* ([US Tech Automations](https://ustechautomations.com/resources/blog/why-home-services-teams-track-warrantyclaim-parts-orders-2026)).

**P12. Callbacks**
- Target rate is about 2%. Each truck roll costs $150–300 ([ACHR News](https://www.achrnews.com/articles/89406-finding-ways-to-reduce-callback-rates)).

**P13. Lock-in and bloat (what incumbents get wrong)**
- **Lock-in:** auto-renewing annual contracts with large early-termination demands (ServiceTitan, [Capterra](https://www.capterra.com/p/150053/ServiceTitan/reviews/6052263/)). A 5-user minimum, slow number porting, and data deleted after non-payment (Workiz, [Trustpilot](https://www.trustpilot.com/review/workiz.com)).
- **Add-on creep:** prices "doubled" when core features became add-ons. Google reviews locked behind higher tiers. Extra users at $29–100/mo ([OneCrew](https://www.getonecrew.com/post/jobber-reviews), [Projul](https://projul.com/blog/housecall-pro-pricing-analysis-2026)).
- **Bloat:** an unused price book, built-in payroll whose tax errors pulled more than $2,000 from an account ([HCP Trustpilot](https://www.trustpilot.com/review/housecallpro.com?page=2)), "AI features" that broke invoice payments, months-long onboarding.
- **No offline mode:** Jobber has none. ServiceTitan crashes and loses notes ([Trustpilot](https://www.trustpilot.com/review/servicetitan.com)).
- **Rigid fields:** a pest-control shop left Jobber over missing chemical logging ([Trustpilot](https://www.trustpilot.com/review/getjobber.com)).
- **Accidental mass review emails** (Workiz). Every bulk send needs explicit confirmation.
- **Countermeasures adopted in the spec:** one-click full export, bring-your-own providers, all modules free behind flags, no AI on the money path, sortable everything, correct handling of $0 invoices, no fee on payouts, custom fields in JSONB.

**P17. Tools and vehicles**
- In the UK, about 1 in 3 tradespeople have had tools stolen from vans, with an average claim of about £2.6k ([Howden](https://www.howdeninsurance.co.uk/howden-hub/nearly-half-of-tool-theft-is-from-vehicles/), [Vanreviewer](https://vanreviewer.co.uk/news/tool-theft-from-uk-vans-now-costs-businesses-3-5bn/)).
- Pop-A-Lock reviewers report techs paying for their own gas and repairs, with maintenance requests ignored ([Indeed](https://www.indeed.com/cmp/Pop--a--lock/reviews?fjobtitle=Locksmith&ftopic=paybenefits), [Glassdoor](https://www.glassdoor.com/Reviews/Pop-A-Lock-Locksmith-Reviews-EI_IE391346.0,10_KO11,20.htm)). This argues for a "report vehicle issue" flow with a response timer.

### 1.2 What owners love in incumbent products (keep these)
- "On my way" and arrival notifications, plus texting from the app.
- Reminders ("customers love the reminders").
- A readable schedule board.
- Clock-in, notes and photos from the field.
- Visibility and reporting.
- Job cards with forms.
- Automatic commission calculation.
- A subcontractor job link that needs no login.

One Housecall Pro customer credits better communication with lifting their Google rating from 2.3 to 4.9.

---

## 2. Payments, deposits and chargeback evidence

### 2.1 Core decisions
1. **The business owns its processor account.** The CRM orchestrates payments but is never the merchant of record. Housecall Pro users complain about unexplained fund holds ([Trustpilot](https://www.trustpilot.com/review/housecallpro.com?page=8)).
2. **Stripe over plain REST** (fetch, form-encoded, no SDK) is the first card adapter. A **manual** adapter covers cash, check, Zelle and Venmo. Square comes later. All adapters write to one internal ledger.
3. **Chargeback protection works by capturing evidence during the job.** Fighting after the fact is the fallback.
4. **Default fee policy is "cash discount", not surcharging.** Surcharge law varies by state and is in flux.

### 2.2 Dispute economics
- Stripe charges $15 per dispute received, which is never refunded, plus another $15 to counter it, refunded only on a win ([Stripe pricing](https://stripe.com/pricing), [Redo](https://redo.com/resources/articles/chargebacks/stripe-chargeback-fees)).
- Win rates run 5–60% depending on Radar risk ([Stripe best practices](https://docs.stripe.com/disputes/best-practices)). Prevention beats fighting.
- Card networks count disputes *received*, not lost:
  - Stripe treats a rate above 0.75% as excessive ([Stripe](https://docs.stripe.com/disputes/measuring)).
  - Visa VAMP is reported at a 1.5% threshold from 2026-04-01 ([fraud.net](https://fraud.net/resources/visas-vamp-thresholds-drop-to-1-5-on-april-1-are-you-ready), vendor).
  - For a shop with fewer than 100 payments a month, one dispute moves the ratio a lot.
- **Cardholder window:** usually 120 days. For prepaid or future services (deposits), it runs **from the service date** ([Stripe](https://docs.stripe.com/disputes/how-disputes-work)). Keep evidence for at least 24 months.
- **Merchant response window on Stripe:** 7–21 days. Inquiries must be answered. Uncaptured authorizations cannot be disputed.
- **Early fraud warnings:** about 40% become disputes. Refund proactively when the amount is at or below the dispute fee.
- A Jobber community thread describes a business that "loses every time" despite photos and GPS, but wins about 85% on other processors ([thread](https://community.getjobber.com/discussions/invoicing-getting-paid/jobber-disputeschargebacks/2330)). **How evidence is packaged and mapped to fields matters as much as having it.**
- UK ombudsman decisions refused locksmith chargebacks when authorization of the amount was provable ([DRN-4465812](https://www.financial-ombudsman.org.uk/decision/DRN-4465812.pdf)).

### 2.3 Dispute categories in home services ([Stripe categories](https://docs.stripe.com/disputes/categories))

| Category | Typical home-service scenario |
|---|---|
| Fraudulent | Card keyed by phone by someone other than the cardholder. Relative or landlord pays. "Not me." |
| Unrecognized | Statement descriptor shows the legal entity name, not the brand |
| Product not received | Deposit paid, job never scheduled. "Tech never came." |
| Product unacceptable | "Didn't fix it." "Never authorized that price." Emergency-rate regret. Scope creep. |
| Credit not processed | Promised refund never issued. Cancelled deposit. |
| Duplicate | Deposit by link plus full amount on site. Check plus card. Terminal retry. |

### 2.4 Evidence mapping (Stripe evidence fields → what the CRM captures)

Stripe's limits ([API](https://docs.stripe.com/api/disputes/update)): PDF/JPEG/PNG only, **4.5 MB combined**, under 50 pages, **19 pages for Mastercard**, one file per evidence type, and no links (issuers don't follow them). Use `submit=false` to stage evidence for review.

| Stripe field | CRM source |
|---|---|
| `customer_signature` | Signed estimate, change orders and completion sign-off, each with an audit block (name, PNG, UTC time, IP, UA, geo, channel, doc SHA-256, policy versions, ESIGN consent) |
| `service_date` | `jobs.completed_at` (and the scheduled date for prepaid work) |
| `service_documentation` | Composite PDF: work order, line items, arrival/departure geostamps, before/after grid with time and GPS, tech name and license # |
| `product_description` | Itemized text, never just "Repair service" |
| `receipt` | Receipt PDF showing method, last4, entry mode, and "appears on statement as …" |
| `customer_communication` | Excerpts: booking confirmation with price, on-my-way, approvals, 7-day check-in reply, review if any |
| `refund_policy` / `cancellation_policy` (+ `_disclosure`) | The exact policy version shown, with the accepted clause, time and IP |
| `cancellation_rebuttal` / `refund_refusal_explanation` | Template text filled from deposit terms and PO date |
| `duplicate_charge_*` | Ledger extract showing deposit and balance as separate payments |
| `access_activity_log` | Portal log: estimate viewed or signed, invoice viewed, pay link opened (IP, UA, time) |
| `uncategorized_text` | Auto-written, neutral, 5–8 sentence chronological narrative |
| `visa_compelling_evidence_3` | Repeat customers only: 2+ prior undisputed charges 120–364 days old on the same payment method ([Stripe CE3.0](https://docs.stripe.com/disputes/api/visa-ce3)) |

**Capture rules**
- **Photos:** iOS Safari strips GPS from camera captures ([WebKit 263192](https://bugs.webkit.org/show_bug.cgi?id=263192)). So:
  - call `navigator.geolocation` at capture time;
  - hash the original with `crypto.subtle`;
  - store server receive time;
  - flag photos where `File.lastModified` is much older than upload time (likely picked from the library);
  - keep photos append-only (soft-delete with an audit entry).
- **Policies:** show the full text inline. A checkbox with only a link may be rejected as evidence ([Stripe prevention](https://docs.stripe.com/disputes/prevention/best-practices)).
- **E-consent:** an explicit checkbox consenting to electronic records, as required by ESIGN ([overview](https://www.blueink.com/electronic-signature-law/esign-act)).
- **Every PaymentIntent** carries the customer email, an itemized description, and the service address as `shipping`. This is free and enables Visa Order Insight / CE3.0 blocking later.
- **Payment-auth snapshot:** entry mode, CVC and AVS checks, 3DS result, brand, funding, last4, card **fingerprint**, and processor fee from `balance_transaction`. The fee feeds commission.

### 2.5 Deposits
**Stripe auth-hold windows** ([doc](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)):
- Online, customer-initiated: 7 days.
- Visa merchant-initiated: about 5 days.
- Card-present: Visa about 5 days; MC, Amex and Discover 2 days.
- Only one partial capture is allowed. Uncaptured holds cannot be disputed.

**Rules of thumb** *(vendor)*: 10–25% for small jobs, up to 50% for large ones, 40–50% for special-order parts ([InvoiceFly](https://invoicefly.com/academy/collecting-deposits-for-service-jobs/)).

**Enforceability:** a "non-refundable" label isn't automatically enforceable ([Wexford](https://www.wexfordins.com/post/taking-deposits-legally)). Phrase it as "non-refundable once the special-order part is ordered", and log the PO.

**⚖️ State and federal rules** (ship as a per-state compliance profile that warns):

| Rule | Summary |
|---|---|
| FTC Cooling-Off Rule ([16 CFR 429](https://www.law.cornell.edu/cfr/text/16/429.0)) | Covers sales of $25+ at the buyer's home. Buyer-initiated repairs are exempt, but **add-on sales during the visit** are covered and need a 3-business-day cancellation notice. The emergency waiver must be handwritten, dated and signed. |
| California ([CSLB 22-14](https://www.cslb.ca.gov/Resources/IndustryBulletins/2022/Industry_Bulletin_Progress_Payment_Restrictions.pdf)) | Home-improvement down payment ≤ the lesser of $1,000 or 10%. Service & repair contracts under $750: no payment until the work is complete. Seniors 65+ get 5 days to cancel. |
| Massachusetts ([c.142A §2](https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXX/Chapter142A/Section2)) | Deposit ≤ the greater of 1/3 of the price or the special-order material cost, on contracts over $1,000 |
| Maryland ([§8-617](https://mgaleg.maryland.gov/2026RS/bills/hb/hb1499F.pdf)) | Deposit ≤ 1/3. A 2026 bill would raise it to 1/2 **[passage unverified]**. |
| Florida ([§489.126](https://flsenate.gov/Laws/Statutes/2025/0489.126)) | If the deposit exceeds 10%: apply for permits within 30 days and start work within 90 days, or refund |
| Connecticut | Home-improvement contract must include the registration #, scope, timeline, payment schedule and a 3-day cancellation notice |

Service types are tagged `improvement` or `repair`, because most of these caps apply only to improvement contracts.

### 2.6 Card fees and surcharges ⚖️
- **Fee table ([Stripe](https://stripe.com/pricing), [Square](https://squareup.com/us/en/payments/our-fees)):**
  - Stripe online: 2.9% + 30¢; keyed +0.5%.
  - Stripe Terminal: 2.7% + 5¢. A web app can drive the S700 reader ($349).
  - Stripe ACH: 0.8%, capped at $5.
  - Square in-person: 2.6% + 15¢. The Square POS API supports app-switch from mobile web, giving card-present rates with no hardware ([POS API](https://developer.squareup.com/docs/pos-api/what-it-does)).
  - Venmo Business: 1.9% + 10¢, with buyer-protection dispute exposure.
  - Zelle, cash, check: $0.
- **Surcharge bans and caps:**
  - Banned in CT and MA. CO caps at 2%. NY requires showing the total card price. California's SB 478 requires all-in pricing ([PaymentCloud](https://paymentcloudinc.com/blog/credit-card-surcharge-laws-by-state/)).
  - Visa: 3% cap, credit only, 30-day notice to the acquirer **[not re-verified]**.
  - The pending Visa/MC settlement (preliminary approval 2026-06-09) caps surcharges at 3% or the cost of acceptance ([summary](https://paykings.com/blog/visa-mastercard-settlement-merchants-2026/)).
- Hosted Checkout doesn't know the funding type (credit vs. debit) before the card is entered, which is one more reason to default to cash discount.
- Card-not-present keyed payments carry the fraud liability. Chip, tap, or 3DS on the customer's own device shifts it ([Square community](https://community.squareup.com/t5/General-Discussion/How-does-the-EMV-liability-shift-affect-keyed-in-payments/m-p/103107)). 3DS covers fraud claims only, not "not as described."

### 2.7 Pay-link pattern (Stripe)
Text a link on the business's own domain, `/p/{token}`. On click, the server creates a Checkout Session for the live balance with:
- inline itemized `price_data`;
- `client_reference_id`;
- `customer_email`;
- `statement_descriptor_suffix`, keeping prefix + suffix ≤ 22 characters ([descriptors](https://docs.stripe.com/get-started/account/statement-descriptors));
- `shipping` set to the service address;
- metadata `job_id`;
- `consent_collection[terms_of_service]=required`;
- `request_three_d_secure=any` when risk is High;
- `capture_method` or `setup_future_usage` per the deposit mode;
- `expires_at` between 30 minutes and 24 hours;
- an idempotency key.

Sessions are created per click, not via Payment Links, so they never go stale.

**Webhook verification without the SDK:** HMAC-SHA256 of `${t}.${rawBody}` using Web Crypto, compared in constant time, rejected if older than 5 minutes.

### 2.8 Invoice and receipt rules
- **Invoices** are immutable once issued: corrections go through revisions or credit notes. Each has a sequential number. Deposits and payments appear as credit lines. Before/after photos can be toggled per service type. Include a pay QR code and a "statement shows as …" note.
- **Charges** above the balance due are blocked, which prevents duplicates.
- **Receipts:** one per payment, sent immediately.
- **Print/PDF:** HTML with `@page`, `break-inside: avoid`, `print-color-adjust: exact`, and `window.print()` for customers. The dispute pack needs a real file, which goes through a server `PdfRenderer` adapter (`pdf-lib` or headless Chrome).

---

## 3. Technician pay and back office

### 3.1 Pay models seen in the wild

| Model | Form | Examples |
|---|---|---|
| Partner split (1099) | 25–60% of (total − tax − tip − parts − card fees), plus 100% of tips, plus reimbursement for tech-paid parts. Cash is netted at settlement. | Locksmith, garage door, appliance. Florida affidavit (50/50, 60/40). Ads offering "40% per job" ([tallo](https://tallo.com/talent/job/manufacturing/locksmith/fl/melbourne/locksmith-19532358)). |
| W-2 commission | % of revenue or gross profit, sometimes with a daily guarantee or a training-period hourly rate | Precision Door: $20–25/hr for 90 days, then commission ([posting](https://jobs.precisiondoor.net/garage-door-service-technician/job/BDEADF215A2AD0B672FED8A6DF0EE2A1)) |
| Hourly + spiff | Hourly pay plus a bonus per item, credited sold-by or worked-by | ServiceTitan ([docs](https://help.servicetitan.com/docs/payroll-detail-report-primary-payroll-settings)) |
| Flat per job | Fixed dollar amount per job type | Workiz |
| Revenue vs. gross profit | Gross-profit basis subtracts unit and labor costs first | Housecall Pro ([help](https://help.housecallpro.com/en/articles/12657750-what-s-the-difference-between-gross-profit-and-revenue-commissions)) |

### 3.2 The reconciled partner formula (BitCRM, matched Workiz to the cent)
From [surelockkey/bitcrm PR #85](https://github.com/surelockkey/bitcrm/pull/85), which matched 1,073 rows:
- `techProfit = (total − tax − tip − techParts − companyParts − feesByMethod) × rate + tip`
- `balance = techProfit + techParts − (cash − cashChargedViaExternalProcessor)`. A positive balance means the company owes the tech.
- **Rate resolution:** job custom rate → tech × job type → base rate. Use the version in force on the close date.
- **Lessons from that build:**
  - **Snapshot the rate on the job when it closes.** 21 rows broke when a rate changed after the fact.
  - **Lock jobs once they are in a settlement.** 2 rows broke because jobs were edited after export.
  - **Integer cents, rounding half away from zero at the line level.**
- Workiz deducts the processing fee from the commission base. Its "credit fee" applies to Zelle, Venmo and ACH by default, so the fee must be a per-method toggle ([Workiz](https://help.workiz.com/en/articles/2250385-setting-commission-rates-for-techs)).
- ServiceTitan's pipeline: commissionable items, minus fees and deductible job costs, times the rate, plus bonuses and adjustments. **Splits apply to commission and bonuses only.**

### 3.3 Worked examples (25% partner plan, 3% card fee, company absorbs the fee on tips)
- **Job A (card):** subtotal $400, tip $20 (charge $420), company parts $40, tech parts $25.
  - Fee on base: $12. Base = 400 − 40 − 25 − 12 = **$323.00**.
  - Commission: **$80.75**. Tech line: 80.75 + 20 + 25 = **+$125.75**.
  - Company keeps 420 − 12.60 − 40 − 125.75 = **$241.65**.
- **Job B (cash, tech keeps it):** $300, tech parts $30.
  - Base $270. Commission $67.50, plus $30 = $97.50.
  - Minus $300 cash held = **−$202.50**.
- **Job C (50% after-hours override):** $250 card, tech parts $20.
  - Base = 250 − 20 − 7.50 = $222.50. Commission $111.25, plus $20 = **+$131.25**.
- **Clawback:** a lost dispute on a $600 job (parts $50, fee $18): base $532, commission $133.00, so **−$133.00**.

**Weekly 1099 settlement:**

| Line | Amount |
|---|---|
| Job A | +125.75 |
| Job B | −202.50 |
| Job C | +131.25 |
| Clawback | −133.00 |
| Prior carry-forward | −40.00 |
| **Net** | **−118.50** (tech owes the company) |

**The same week under W-2:**
- Wages = 80.75 + 20 + 67.50 + 111.25 = **$279.50**.
- Reimbursements of $75 are paid separately.
- The $300 cash goes to a **separate remittance ledger**, never a wage deduction.
- The clawback applies only if the signed agreement and the state allow it.
- Add a minimum-wage and overtime floor check.

### 3.4 Where disputes come from ⚖️
- **Opaque pay stubs** ("will cheat u if u don't watch your stub"). Fix: a per-job calculation trace, a live balance, and the ability for techs to flag lines before approval.
- **Recall clawbacks are manual everywhere.** A Massachusetts user says docking pay for recalls is illegal ([ST community](https://community.servicetitan.com/t5/Accounting/Charge-back-to-original-technician-for-recall-jobs/td-p/26379)).
- **Card fees taken from commission** are generally allowed only if agreed in writing beforehand, and never below minimum wage ([JustAnswer](https://www.justanswer.com/employment-law/7x1p1-employer-charge-salesman-employee-credit-card-processing.html)).
- **W-2 deductions:**
  - FLSA: no deductions below minimum wage or into overtime ([DOL FS#16](https://www.dol.gov/agencies/whd/fact-sheets/16-flsa-wage-deductions)).
  - California: cash-shortage and breakage deductions only for dishonesty or gross negligence ([DLSE](https://dir.ca.gov/dlse/faq_deductions.htm)).
  - New York: cash-shortage deductions are illegal ([NY DOL](https://dol.ny.gov/illegal-deductions)).
  - Texas: needs specific written authorization.
- **California Labor Code §2751:** written commission agreement with a signed receipt ([code](https://california.public.law/codes/labor_code_section_2751)).
- **Tip card fee:** California forbids deducting the card fee from tips ([EBG](https://www.ebglaw.com/workforce-bulletin/time-is-money-a-quick-wage-hour-tip-on-the-tip-credit)).
- **Overtime:** commissions go into the regular rate. HVAC techs are usually non-exempt ([ACCA](https://hvac-blog.acca.org/cracking-the-overtime-code/)).
- **1099-NEC threshold:** $2,000 for payments made in 2026 onward ([Patriot](https://www.patriotsoftware.com/blog/accounting/1099-reporting-threshold/)).
- **Contractor classification:** the DOL proposed rescinding the 2024 contractor rule (2026-02-26), with no final rule found ([HR Dive](https://www.hrdive.com/news/dol-independent-contractor-rule-2026/813202/)). California's ABC test still applies.
- **Accountable plans:** substantiate within about 60 days, return any excess within about 120 days ([Bench](https://help.bench.co/article/irs-accountable-plan)).

### 3.5 Payouts ("paycheck deposit")
- **Do not build payroll or tax withholding.** Record payouts (method, reference, proof) and export CSV for Gusto or ADP.
- **Free ACH:** a NACHA file the company uploads to its own bank, using PPD for personal accounts and CCD for business accounts ([Tipalti](https://tipalti.com/resources/learn/nacha-file-format/)).
- **Paid adapters later:**
  - Stripe Connect: about 0.25% + 25¢ per payout, plus $2 per active account per month ([Stripe](https://stripe.com/it-us/connect/pricing)).
  - Gusto Contractor: $35/mo + $6 per contractor ([Rivermate](https://rivermate.com/blog/gusto-pricing)).

### 3.6 Parts
- **Two paths:**
  - *Company-paid* (truck stock, company card, PO): deducted from the commission base, with no reimbursement.
  - *Tech-paid*: needs a receipt photo and approval. It becomes a reimbursement line and is also deducted from the base, so the tech earns commission on the markup but not on the cost.
- **Markup matrix starting point:** under $20 → ×4–6; $20–100 → ×2.5–3.5; large components → ×1.5–2.5 ([Relay](https://relayfi.com/blog/hvac-price-book-template/)). A 30% markup is only a 23% margin ([Jobber](https://getjobber.com/academy/hvac/hvac-parts-markup-calculator/)).
- **Truck stock:** min/max per vehicle for the 30–80 parts that cover most calls ([Enterprise DNA](https://enterprisedna.co/resources/blog/trades-van-inventory-tracking-software)).

### 3.7 Vehicles
- **VIN decoding** is free with no key: `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json`. Recalls come from `api.nhtsa.gov/recalls/recallsByVehicle` ([vPIC](https://vpic.nhtsa.dot.gov/api/)).
- **Reminders** follow the Fleetio model: miles and/or days, whichever comes first, a "due soon" threshold, forecasting from average daily miles, and reset only when the matching service is logged ([Fleetio](https://help.fleetio.com/en_US/service-reminders-overview)).
- **Oil interval default** for work vans: 5,000 mi / 6 months. Severe service cuts intervals by 30–50% ([HVI](https://heavyvehicleinspection.com/article/synthetic-oil-change-interval-trucks)).
- **USDOT number:** required in about 33 states for vehicles at or above 10,001 lb GVWR ([Deeley](https://deeleyinsurance.com/does-my-commercial-motor-vehicle-need-a-usdot-number/)).
- **IRS mileage log (Pub 463):** record date, destination, purpose and miles "at or near the time". No estimates. Keep records 3 years ([IRS P463](https://www.irs.gov/publications/p463)).
- **IRS mileage rate:** 2026 is **72.5¢/mi** ([IRS](https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile-up-25-cents)). A reported revision to 76¢ from 2026-07-01 is **[unverified]**, so the rate is admin-editable.

### 3.8 Gemini (free tier), as of October 2026
- **Models:** `gemini-3.8-flash` (GA 2026-09-02); `gemini-3.6-flash` and `gemini-3.5-flash-lite` (GA 2026-07-21). Since 2026-09-18, `gemini-2.5-*` is restricted to projects that already used it ([changelog](https://ai.google.dev/gemini-api/docs/changelog)).
- **Parameters:** `temperature`, `top_p` and `top_k` are deprecated, so don't send them.
- **Limits:** free-tier numbers are no longer published. Limits are per project. **Design for about 20 requests per day** ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)).
- **Terms:** free-tier input may be read by human reviewers. *"Do not submit sensitive, confidential, or personal information."* EEA, CH and UK users must use the paid tier ([terms](https://ai.google.dev/gemini-api/terms)). **On the free tier, send only odometer photos, parts and fuel receipts, and tool photos.**
- **Images:** downscale to about 1024 px and fix EXIF rotation first; rotated images break extraction ([forum](https://discuss.ai.google.dev/t/data-extraction-accuracy-issues-from-documents-due-to-image-orientation-and-ocr/93461)).
- **Output:** use `responseSchema` JSON. Always validate in code, because Flash versions can regress.
- **Anomaly detection is rules first:**
  - the odometer goes backwards;
  - fuel gallons exceed tank size;
  - MPG drops more than 20%;
  - two fuel buys in one day.

  The LLM only explains the flags.

### 3.9 Tools
- **Record fields:** serial #, QR tag, photos, owner (company or tech), status, condition, calibration due date.
- **Assignment:** check-out and check-in by scan, with photos. Block assignment when calibration is overdue ([eturns](https://www.eturns.com/solutions/modules/tool-tracking-maintenance)).
- **Audits:** periodic photo audits.
- **Deductions for lost tools** are OFF by default ⚖️ (CA only for theft or gross negligence, prohibited in NY, needs written authorization in TX; [ACCA](https://hvac-blog.acca.org/deductions-for-company-equipment/)).

---

## 4. Messaging, compliance and lead intake

### 4.1 Free SMS options

| Option | Status | Use |
|---|---|---|
| `sms:` deep link with prefilled body | Works on iOS and Android; body syntax differs by platform ([Sendblue](https://docs.sendblue.com/guides/imessage-link-button/)) | **Default free driver.** A person taps Send. |
| Carrier email-to-SMS | AT&T shut down 2025-06-17; T-Mobile is dead; Verizon is ending ([TextBolt](https://textbolt.com/blog/att-email-to-text-alternative/)) | **Do not use** |
| Android phone as a gateway (SMSGate Apache-2.0, textbee MIT) | Active | Optional low-volume driver. Consumer plans usually forbid A2P use. |
| WhatsApp `wa.me/<digits>?text=` | Works | Second link channel |
| Web Share API | HTTPS only, needs a user gesture ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)) | "Share invoice/photos" |
| Email via Resend free tier (3,000/mo, 100/day) | Works ([summary](https://automationatlas.io/answers/resend-free-tier-explained-2026/)) | Invoices, estimates, receipts |
| Web Push (installed PWA, iOS 16.4+) | Works ([OneSignal](https://documentation.onesignal.com/docs/web-push-for-ios), [WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)) | **All staff alerts** |

**`sms:` syntax:** Apple devices use `&body=`; others use `?body=`. Ship a per-device override (`?`, `&`, `?&`), a "send test to myself" button, and a Copy fallback. Never use multi-recipient links ([Seth Larson](https://sethmlarson.dev/sms-urls)).

**Link-mode limits:** no inbound replies, no delivery receipts, and texts come from the staff member's own number. Recommend a dedicated company phone.

### 4.2 Paid SMS (later)
- **Per-segment prices:**
  - Twilio: $0.0083 per segment, $1.15/mo per local number ([pricing](https://www.twilio.com/en-us/sms/pricing/us)).
  - Telnyx: $0.004 per segment, $1/mo per number ([pricing](https://telnyx.com/pricing/messaging)).
  - Carrier pass-through adds about $0.0035–0.005 per segment.
- **All-in cost:** about $0.012 per segment on Twilio and $0.008 on Telnyx. At 150 jobs × 10 messages, that is about $19/mo or $12/mo.
- **A2P 10DLC fees:** brand $4.50 (sole proprietor or low-volume) or $46 (standard); campaign vetting $15; $1.50–10/mo per campaign ([Twilio](https://support.twilio.com/hc/en-us/articles/1260803965530)).
- **Toll-free:** must be verified since 2024-01-31. Verification is free and takes 3–5 days.
- **Rejection causes to design out:**
  - pre-checked consent box (30925);
  - consent required to submit the form (30931);
  - consent text missing frequency, rates or STOP language (30924);
  - privacy policy missing the "no sharing of mobile opt-in data" clause (30932/30908);
  - public URL shorteners (30963).
- **Deliverability:** a Jobber thread reports invoices texted from an iPhone on Verizon never arriving ([thread](https://community.getjobber.com/discussions/invoicing-getting-paid/jobber-mobile-invoices-not-sending/14397)). Show delivery status on every message and offer a "Go live with SMS" wizard.

### 4.3 Compliance ⚖️
- **TCPA revocation rule (effective 2025-04-11):**
  - Opt-outs by "any reasonable means" must be honored within 10 business days.
  - One confirmation text within 5 minutes is allowed.
  - "Revoke-all" is delayed to 2027-01-31 ([Burr](https://www.burr.com/telephone-consumer-protection-act/the-fcc-delays-effective-date-of-tcpa-revoke-all-rule-until-january-31-2027)).
  - Implementation: apply opt-outs instantly and suppress all automated messages.
  - Opt-out keywords: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT, OPT OUT ([Kelley Drye](https://www.kelleydrye.com/viewpoints/blogs/ad-law-access/fcc-sets-effective-date-for-tcpa-reasonable-consent-revocation-rules)).
- **Quiet hours:**
  - Federal: 8am–9pm ([47 CFR 64.1200](https://www.law.cornell.edu/cfr/text/47/64.1200)).
  - FL, OK, MD and WA: 8am–8pm, and MD caps at 3 messages per 24 h ([Goodwin](https://goodwinlaw.com/en/insights/publications/2023/02/02_28-mini-tcpa-laws-you-should-know)).
  - **Default: 8:00–20:00 in the recipient's local time.** Out-of-window messages are deferred, not dropped.
- **Consent ledger:** append-only, retained 4–5 years (the TCPA limitation period is 4 years).
- **Default opt-in text** (unchecked box): *"I agree to receive text messages from {company} about my request, appointments and invoices. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help."* Marketing needs a separate, unchecked opt-in.
- **Hygiene:**
  - Keep templates GSM-7: emojis and curly quotes switch to UCS-2, cutting a segment from 160 to 70 characters.
  - Use own-domain links only.
  - Send at most 3 automated non-live messages per customer per day and 1 marketing message per 7 days.

### 4.4 Review requests ⚖️
- **Timing:** within 1–2 h of completion (after payment), SMS first, with one reminder around day 3 *(vendor)* ([Cloutly](https://cloutly.com/blog/sms-vs-email-review-requests/)).
- **Google** prohibits selective solicitation (gating), any incentive, pressuring on-premises reviews, and soliciting specific content ([policy](https://support.google.com/contributionpolicy/answer/7400114)).
- **FTC rule 16 CFR 465** (effective 2024-10-21): penalties up to $53,088 per violation. The FTC says gating "could violate the FTC Act" ([FTC Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)).
- **Yelp** forbids asking for reviews at all ([SEL](https://searchengineland.com/yelp-increasingly-cracking-review-solicitation-across-internet-286290)). Never offer Yelp as a target.
- **Link:** prefer the GBP share link `g.page/r/<id>/review`. The constructed `writereview?placeid=` link is undocumented and has returned 400 errors in 2026 ([Make community](https://community.make.com/t/anyone-successfully-using-google-review-deep-links-in-2026-getting-400-errors/108466)). Always send through our own `/r/{token}` redirect.
- **Tech attribution** comes from the token click. Don't ask customers to name the tech.

### 4.5 Lead intake integrations
- **Thumbtack:** self-serve webhooks. A new lead arrives as `NegotiationCreatedV4` with `negotiationID`, `category.name`, `customer.displayName`, `details[]` and `leadPrice` ([docs](https://developers.thumbtack.com/docs/pro-integrations/self-serve-webhooks)).
- **Angi:** fixed JSON POST, set up by emailing crmintegrations@angi.com. The secret must go in the URL path ([Angi help](https://intercom.help/angi/en/articles/10288125-setting-up-your-crm-integration-with-angi)).
- **Google Ads lead forms:** payload carries `lead_id`, `user_column_data[]`, `google_key` and `is_test`. Return 200 `{}` and dedupe on `lead_id` ([Google](https://developers.google.com/google-ads/webhook/docs/implementation)).
- **Google LSA:** no webhook. Poll `local_services_lead` or parse notification emails ([Google](https://developers.google.com/local-services-ads/guides/reporting)).
- **Yelp:** Zapier or the email parser ([Zapier](https://zapier.com/l/yelp-leads-conversions)).
- **Catch-all:** a Cloudflare Email Worker parser for marketplace emails ([Cloudflare](https://blog.cloudflare.com/announcing-route-to-workers)).
- **Spam defenses:** honeypot field, a minimum 3 s time-to-submit, per-IP and per-key rate limits, and optional Cloudflare Turnstile with server-side `siteverify` ([Nutshell](https://www.nutshell.com/blog/8-ways-to-combat-form-spam)).

---

## 5. Platform constraints
- **Background location:** a web app gets none on iOS. Stamp location on status changes and post it while the app is open.
- **Location-tracking law ⚖️:** NY, CT and DE require written notice of electronic monitoring. California's Penal Code §637.7 restricts tracking devices ([Clockspot](https://www.clockspot.com/research/gps-employee-monitoring-laws-by-state)). Capture an acknowledgment and track only on shift.
- **Background Sync:** iOS has none ([Apple forum](https://developer.apple.com/forums/thread/694805)). Flush the outbox when the app opens and on the `online` event.
- **iOS web push:** only for apps installed to the home screen. Show an in-app install prompt.
- **Vercel Hobby:** non-commercial use only, and cron runs once a day ([limits](https://vercel.com/docs/limits/fair-use-guidelines), [cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)). Use an external minute pinger plus an in-app `after()` piggy-back trigger.
- **Neon Free:** 1 GB and 100 CU-hours per month. A 24/7 five-minute cron exceeds the CU allowance, so run cron only during business hours ([Neon](https://neon.com/pricing)).
- **Supabase Free:** paused after a week of inactivity, no backups ([pricing](https://supabase.com/pricing)).
- **Cloudflare R2:** 10 GB with free egress ([pricing](https://developers.cloudflare.com/r2/pricing/)). Best place for photos.
- **OSM tiles:** "commercial services… should expect access to be withdrawn" ([policy](https://operations.osmfoundation.org/policies/tiles/)). Set the tile URL by env var.

---

## 6. Verified stack decisions (npm registry checked 2026-10-14)

| Area | Decision | Reason / source |
|---|---|---|
| Framework | **Next 16.4.1**, App Router, Cache Components + Partial Prefetching | 16.4 recommends Cache Components; it becomes the default in 17 ([blog](https://nextjs.org/blog/next-16-4)) |
| React | **19.3.1** | `<ViewTransition>` is stable ([guide](https://nextjs.org/docs/app/guides/view-transitions)) |
| TypeScript / lint | **TS 7.0.2 + Biome 2.5.15** (fallback: TS 6.0.3 + ESLint) | typescript-eslint only supports TS < 6.1 |
| CSS | **Tailwind 4.3.3** (`@tailwindcss/postcss`) | No v5 exists |
| ORM | **drizzle-orm 0.45.4 / drizzle-kit 0.31.11**, core query builder only | 1.0 is still RC. 0.45.2+ fixes CVE-2026-39356. |
| Dev DB | **@electric-sql/pglite 0.5.10** (0.5.8 is the conservative pin) | PG 18.3. Single connection. Don't use PG18-only features. |
| Prod DB | **pg 8.23.1 Pool** + `drizzle-orm/node-postgres` + `attachDatabasePool` | Neon recommends TCP pooling on Fluid compute ([Neon](https://neon.com/docs/guides/vercel-connection-methods)) |
| Passwords | **Argon2id via `node:crypto`** (Node ≥ 24.7). Fallback: scrypt N=2^17 with `maxmem: 256 MiB`. | OWASP parameters m=19456, t=2, p=1 ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)) |
| Runtime | **Node 24.x LTS** | Vercel deprecated Node 20 on 2026-10-01 |
| Animation | **CSS spring `linear()` + `<ViewTransition>` first; motion 14.2.0 `m` + LazyMotion** for gestures only | `m` costs 4.6 KB; `domMax` +25 KB, lazy ([motion](https://motion.dev/docs/react-reduce-bundle-size)) |
| Sheet | **Hand-rolled `<dialog>` + Motion drag** | Vaul is unmaintained |
| Icons | **lucide-react 1.57.0** | Auto `optimizePackageImports` |
| Map | **Leaflet 1.9.4**, tile URL from env, dynamic import | 43 KB vs. MapLibre's 287 KB |
| Charts | Hand-rolled SVG in Server Components | Zero client JS |
| Images | `createImageBitmap` + canvas (~1 KB) | browser-image-compression is 19.6 KB |
| Storage | **aws4fetch 1.0.20** presigned PUT to S3/R2 | AWS SDK is too heavy |
| Push | **web-push 3.6.7** (VAPID) | |
| Validation | **zod 4.6.7** | |

**Next 16 rules the codebase depends on** ([upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)):
- Request APIs are async. `proxy.ts` replaces `middleware.ts`; it runs on Node and does no DB calls.
- Reading `cookies()` outside `<Suspense>` is a build error under Cache Components.
- `updateTag` gives read-your-writes and works only inside actions.
- Server Actions have a 1 MB body limit, and Vercel request bodies cap at 4.5 MB, so **photos go directly to storage via presigned URL**.
- `after()` runs work after the response.
- `next lint` is gone. Measure bundles with `next analyze`.
- Keep the generated `AGENTS.md` block that points at version-matched docs in `node_modules/next/dist/docs`.

**iOS design facts:**
- HIG systemBlue is now **#0088FF light / #0091FF dark**. It is 3.52:1 on white, so it fails AA for small text; use `#0066E0` for small link text.
- Springs follow Apple's WWDC23 conversion: `stiffness = (2π/d)²`, `damping = (1−bounce)·4π/d` ([WWDC23 10158](https://developer.apple.com/videos/play/wwdc2023/10158/)).
- CSS `linear()` works in Safari 17.2+. Scroll-driven animations need iOS 26+, with an IntersectionObserver fallback.
- iOS has no `navigator.vibrate`.
- Inputs need ≥ 16 px text, or iOS zooms on focus.
