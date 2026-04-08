import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQaMultipassPlan, renderQaMultipassGuestScript } from "./multipass.runtime.js";

describe("qa multipass runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects output directories outside the mounted repo root", () => {
    expect(() =>
      createQaMultipassPlan({
        repoRoot: process.cwd(),
        outputDir: "/tmp/qa-out",
      }),
    ).toThrow("qa suite --runner multipass requires --output-dir to stay under the repo root");
  });

  it("rejects repo-local symlink output directories that escape the repo root", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-multipass-"));
    const repoRoot = path.join(tempRoot, "repo");
    const outsideRoot = path.join(tempRoot, "outside");
    const symlinkPath = path.join(repoRoot, "artifacts-link");
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({ packageManager: "pnpm@10.32.1" }),
      "utf8",
    );
    fs.symlinkSync(outsideRoot, symlinkPath);

    try {
      expect(() =>
        createQaMultipassPlan({
          repoRoot,
          outputDir: path.join(symlinkPath, "qa-out"),
        }),
      ).toThrow("qa suite --runner multipass requires --output-dir to stay under the repo root");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reuses suite scenario semantics and resolves mounted artifact paths", () => {
    const repoRoot = process.cwd();
    const outputDir = path.join(repoRoot, ".artifacts", "qa-e2e", "multipass-test");
    const plan = createQaMultipassPlan({
      repoRoot,
      outputDir,
    });

    expect(plan.outputDir).toBe(outputDir);
    expect(plan.scenarioIds).toEqual([]);
    expect(plan.qaCommand).not.toContain("--scenario");
    expect(plan.guestOutputDir).toBe("/workspace/openclaw-host/.artifacts/qa-e2e/multipass-test");
    expect(plan.reportPath).toBe(path.join(outputDir, "qa-suite-report.md"));
    expect(plan.summaryPath).toBe(path.join(outputDir, "qa-suite-summary.json"));
  });

  it("renders a guest script that runs the mock qa suite with explicit scenarios", () => {
    const plan = createQaMultipassPlan({
      repoRoot: process.cwd(),
      outputDir: path.join(process.cwd(), ".artifacts", "qa-e2e", "multipass-test"),
      scenarioIds: ["channel-chat-baseline", "thread-follow-up"],
    });

    const script = renderQaMultipassGuestScript(plan);

    expect(script).toContain("pnpm install --frozen-lockfile");
    expect(script).toContain("pnpm build");
    expect(script).toContain("corepack prepare 'pnpm@10.32.1' --activate");
    expect(script).toContain("'pnpm' 'openclaw' 'qa' 'suite' '--provider-mode' 'mock-openai'");
    expect(script).toContain("'--scenario' 'channel-chat-baseline'");
    expect(script).toContain("'--scenario' 'thread-follow-up'");
    expect(script).toContain("/workspace/openclaw-host/.artifacts/qa-e2e/multipass-test");
  });

  it("carries live suite flags and forwarded auth env into the guest command", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const plan = createQaMultipassPlan({
      repoRoot: process.cwd(),
      outputDir: path.join(process.cwd(), ".artifacts", "qa-e2e", "multipass-live-test"),
      providerMode: "live-frontier",
      primaryModel: "openai/gpt-5.4",
      alternateModel: "openai/gpt-5.4",
      fastMode: true,
      scenarioIds: ["channel-chat-baseline"],
    });

    const script = renderQaMultipassGuestScript(plan);

    expect(plan.qaCommand).toEqual(
      expect.arrayContaining([
        "--provider-mode",
        "live-frontier",
        "--model",
        "openai/gpt-5.4",
        "--alt-model",
        "openai/gpt-5.4",
        "--fast",
      ]),
    );
    expect(plan.forwardedEnv.OPENAI_API_KEY).toBe("test-openai-key");
    expect(script).toContain("OPENAI_API_KEY='test-openai-key'");
    expect(script).toContain("'pnpm' 'openclaw' 'qa' 'suite' '--provider-mode' 'live-frontier'");
  });

  it("skips stale CODEX_HOME values that do not exist on the host", () => {
    vi.stubEnv("CODEX_HOME", "/tmp/does-not-exist-openclaw-codex-home");
    const plan = createQaMultipassPlan({
      repoRoot: process.cwd(),
      outputDir: path.join(process.cwd(), ".artifacts", "qa-e2e", "multipass-live-test"),
      providerMode: "live-frontier",
    });

    expect(plan.forwardedEnv.CODEX_HOME).toBeUndefined();
    expect(plan.hostCodexHomePath).toBeUndefined();
    expect(plan.guestCodexHomePath).toBeUndefined();
  });
});
