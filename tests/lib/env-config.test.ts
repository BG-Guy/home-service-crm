import { afterEach, describe, expect, it, vi } from "vitest";

// QA T1-01: production must not boot (or report healthy) without SESSION_SECRET.
describe("production config checks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("lists a missing SESSION_SECRET as fatal and refuses to boot", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.resetModules();
    const { configProblems, sessionSecret } = await import("@/lib/env");
    expect(configProblems()).toEqual({
      fatal: ["SESSION_SECRET"],
      warnings: ["APP_URL", "CRON_SECRET"],
    });
    expect(() => sessionSecret()).toThrowError(
      expect.objectContaining({ code: "server_misconfigured" }),
    );
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow(/SESSION_SECRET/);
  });

  it("is quiet in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_SECRET", "");
    vi.resetModules();
    const { configProblems } = await import("@/lib/env");
    expect(configProblems()).toEqual({ fatal: [], warnings: [] });
  });
});
