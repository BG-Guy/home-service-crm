// NHTSA recalls adapter (QA T1-11/T3-09): HTTP 400 = no match, base-model retry.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getVinDecoder, modelCandidates } from "@/adapters/vin";

const recall = {
  NHTSACampaignNumber: "24V123000",
  Component: "BRAKES",
  Summary: "Brake hose may chafe.",
  Consequence: "Not Applicable",
  Remedy: "Dealers will replace the hose.",
  ReportReceivedDate: "01/02/2024",
};

function mockFetch(
  byModel: Record<string, { status: number; body?: unknown }>,
) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const model = new URL(url).searchParams.get("model") ?? "";
      calls.push(model);
      const r = byModel[model] ?? { status: 400, body: { results: [] } };
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("modelCandidates", () => {
  it("full name, then two words, then the base model", () => {
    expect(modelCandidates("F-150 XLT SuperCrew 4x4")).toEqual([
      "F-150 XLT SuperCrew 4x4",
      "F-150 XLT",
      "F-150",
    ]);
    expect(modelCandidates("Transit Connect")).toEqual([
      "Transit Connect",
      "Transit",
    ]);
    expect(modelCandidates(" Sprinter ")).toEqual(["Sprinter"]);
  });
});

describe("recalls", () => {
  it("HTTP 400 on every candidate is an empty list, not an error", async () => {
    const calls = mockFetch({});
    await expect(
      getVinDecoder().recalls("Ford", "F-150 SuperCrew", 2022),
    ).resolves.toEqual([]);
    expect(calls).toEqual(["F-150 SuperCrew", "F-150"]);
  });

  it("retries with the base model after a 400", async () => {
    const calls = mockFetch({
      "F-150": { status: 200, body: { results: [recall] } },
    });
    const list = await getVinDecoder().recalls("Ford", "F-150 SuperCrew", 2022);
    expect(calls).toEqual(["F-150 SuperCrew", "F-150"]);
    expect(list).toEqual([
      {
        campaign: "24V123000",
        component: "BRAKES",
        summary: "Brake hose may chafe.",
        consequence: null,
        remedy: "Dealers will replace the hose.",
        reportedOn: "01/02/2024",
      },
    ]);
  });

  it("a 200 for the full model wins (no fallback)", async () => {
    const calls = mockFetch({
      "Transit Connect": { status: 200, body: { results: [] } },
      Transit: { status: 200, body: { results: [recall] } },
    });
    expect(
      await getVinDecoder().recalls("Ford", "Transit Connect", 2021),
    ).toEqual([]);
    expect(calls).toEqual(["Transit Connect"]);
  });

  it("server errors still throw (the worker retries)", async () => {
    mockFetch({ Sprinter: { status: 503 } });
    await expect(
      getVinDecoder().recalls("Mercedes-Benz", "Sprinter", 2020),
    ).rejects.toThrow(/503/);
  });
});
