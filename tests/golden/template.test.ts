import { describe, expect, it } from "vitest";
import {
  extractVariables,
  render,
  renderWithReport,
  smsSegments,
  toGsmSafe,
} from "@/lib/template";

// Golden tests for the §7.4 renderer and the SMS segment counter.

const ctx = {
  customer: { first_name: "Dana", last_name: "Lee" },
  company: {
    name: "Acme Home Services",
    phone: "(512) 555-0100",
    lead_response_minutes: "10",
  },
  "lead.service": "Rekey",
  job: { window: "1–2 PM", link: "https://acme.example/j/abc" },
  invoice: { total_cents: 123456, due: "2026-10-14T18:30:00Z" },
  eta_minutes: 25,
  empty: "",
  _tz: "America/Chicago",
};

describe("render (SPEC §7.4)", () => {
  it("substitutes nested and flat dotted paths", () => {
    expect(
      render("Hi {{customer.first_name}}, re: {{lead.service}}", ctx),
    ).toBe("Hi Dana, re: Rekey");
    expect(render("ETA {{eta_minutes}} min", ctx)).toBe("ETA 25 min");
  });

  it("uses the fallback for missing or empty values, '' when none", () => {
    expect(render("Hi {{customer.nickname|there}}!", ctx)).toBe("Hi there!");
    expect(render("Thanks {{customer.nickname|}}!", ctx)).toBe("Thanks !");
    expect(render("[{{empty|n/a}}]", ctx)).toBe("[n/a]");
    expect(render("[{{nope}}]", ctx)).toBe("[]");
  });

  it("renders the spec's lead.ack example", () => {
    const tpl =
      "Hi {{customer.first_name|there}}, it's {{company.name}}. We got your {{lead.service}} request and will call you within {{company.lead_response_minutes}} min from {{company.phone}}. Reply STOP to opt out.";
    expect(render(tpl, ctx)).toBe(
      "Hi Dana, it's Acme Home Services. We got your Rekey request and will call you within 10 min from (512) 555-0100. Reply STOP to opt out.",
    );
    expect(render(tpl, {})).toContain("Hi there, it's . We got your  request");
  });

  it("supports money/date/time/case filters", () => {
    expect(render("{{invoice.total_cents:money}}", ctx)).toBe("$1,234.56");
    expect(render("{{invoice.total_cents:money0}}", ctx)).toBe("$1,235");
    expect(render("{{invoice.due:date}}", ctx)).toBe("Wed Oct 14");
    expect(render("{{invoice.due:time}}", ctx)).toBe("1:30 PM");
    expect(render("{{invoice.due:date_long}}", ctx)).toBe(
      "Wednesday, October 14, 2026",
    );
    expect(render("{{customer.first_name:upper}}", ctx)).toBe("DANA");
    expect(render("{{missing:money|TBD}}", ctx)).toBe("TBD");
  });

  it("does not render objects and reports missing variables", () => {
    const r = renderWithReport("{{customer}} {{job.window}} {{x.y|-}}", ctx);
    expect(r.text).toBe(" 1–2 PM -");
    expect(r.missing).toEqual(["customer", "x.y"]);
    expect(r.variables).toEqual(["customer", "job.window", "x.y"]);
  });

  it("HTML-escapes values (not the template) for email", () => {
    expect(
      render("<b>{{v}}</b>", { v: `<script>"x"&'y'` }, { escape: "html" }),
    ).toBe("<b>&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;</b>");
  });

  it("tolerates whitespace inside tags and extracts variables", () => {
    expect(render("{{ customer.first_name }}", ctx)).toBe("Dana");
    expect(extractVariables("{{a}} {{b.c|x}} {{a}} {{d:money}}")).toEqual([
      "a",
      "b.c",
      "d",
    ]);
  });

  it("leaves non-tags alone", () => {
    expect(render("{{1abc}} {single} {{ }}", ctx)).toBe(
      "{{1abc}} {single} {{ }}",
    );
  });
});

describe("smsSegments (GSM-7 vs UCS-2)", () => {
  it("counts GSM-7 septets: 160 per single, 153 per multipart", () => {
    expect(smsSegments("")).toMatchObject({ encoding: "GSM-7", segments: 0 });
    expect(smsSegments("a".repeat(160))).toMatchObject({
      encoding: "GSM-7",
      units: 160,
      segments: 1,
      remaining: 0,
    });
    expect(smsSegments("a".repeat(161))).toMatchObject({
      segments: 2,
      perSegment: 153,
      remaining: 145,
    });
    expect(smsSegments("a".repeat(306))).toMatchObject({ segments: 2 });
    expect(smsSegments("a".repeat(307))).toMatchObject({ segments: 3 });
  });

  it("extension characters count as two septets", () => {
    expect(smsSegments("€{}[]~^\\|")).toMatchObject({
      encoding: "GSM-7",
      units: 18,
    });
    expect(smsSegments(`${"a".repeat(159)}€`)).toMatchObject({
      units: 161,
      segments: 2,
    });
  });

  it("switches to UCS-2 (70 / 67) for emoji and curly quotes", () => {
    const emoji = smsSegments("On my way 🚗");
    expect(emoji.encoding).toBe("UCS-2");
    expect(emoji.units).toBe(12); // surrogate pair counts 2
    expect(emoji.nonGsmChars).toEqual(["🚗"]);
    expect(smsSegments("’".repeat(70))).toMatchObject({
      encoding: "UCS-2",
      segments: 1,
    });
    expect(smsSegments("’".repeat(71))).toMatchObject({
      segments: 2,
      perSegment: 67,
    });
  });

  it("toGsmSafe replaces typographic characters", () => {
    const fixed = toGsmSafe("It’s “done” — see you…");
    expect(fixed).toBe(`It's "done" - see you...`);
    expect(smsSegments(fixed).encoding).toBe("GSM-7");
  });
});
