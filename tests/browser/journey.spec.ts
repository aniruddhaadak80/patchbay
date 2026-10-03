import { expect, test, type Page } from "@playwright/test";

/**
 * Primary journey, exercised through visible UI controls only:
 * create -> inspect -> patch lanes -> compile -> agent API mutation -> export -> delete.
 * Every assertion checks that state actually persisted, not that a click happened.
 */

async function consoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

const stamp = Date.now().toString().slice(-7);

test.describe("Patchbay primary journey", () => {
  test("full CRUD loop through the UI with no console errors", async ({ page }) => {
    const errors = await consoleErrors(page);

    // --- landing ---------------------------------------------------------
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("model");
    await expect(page.getByRole("link", { name: /Star on GitHub/i }).first()).toBeVisible();

    // --- create ----------------------------------------------------------
    await page.goto("/agents/new");
    await page.getByLabel("Agent name").fill(`browser-agent-${stamp}`);
    await page
      .getByLabel("Task class")
      .fill("Route inbound support tickets to cheap models and escalate hard cases.");
    await page.getByLabel("Monthly budget (USD)").fill("250");

    const fastSelect = page.getByLabel("Fast lane model");
    const options = await fastSelect.locator("option").allTextContents();
    expect(options.length).toBeGreaterThan(1);
    const firstModelValue = await fastSelect.locator("option").nth(1).getAttribute("value");
    expect(firstModelValue).toBeTruthy();
    await fastSelect.selectOption(firstModelValue!);

    await page.getByRole("button", { name: "Create agent" }).click();
    await page.waitForURL(/\/agents\/[0-9a-f-]{36}$/);
    const agentUrl = page.url();
    const agentId = agentUrl.split("/").pop()!;
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`browser-agent-${stamp}`);

    // --- inspect: the create persisted a real compiled score --------------
    await expect(page.getByText("Compiled routing policy")).toBeVisible();
    await expect(page.getByText("policy-compiler@1.0.0").first()).toBeVisible();
    const scoreReadout = page.locator('svg[role="img"]').first();
    await expect(scoreReadout).toBeVisible();

    // --- patch the balanced lane through the patch bay --------------------
    const modelJack = page.getByRole("button", { name: /MTok in/ }).nth(3);
    const jackName = (await modelJack.textContent()) ?? "";
    await modelJack.click();
    const balancedButton = page
      .getByRole("button", { name: "Patch here" })
      .nth(1);
    await balancedButton.click();
    await expect(page.getByRole("status")).toContainText("balanced", { timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    // --- the patch persisted across a full reload -------------------------
    await page.reload();
    // The persisted lane, not client state: the jack carries its stored model id.
    const balancedJack = page.locator('[data-lane="balanced"]');
    await expect(balancedJack).toBeVisible();
    const persistedModelId = await balancedJack.getAttribute("data-model-id");
    expect(persistedModelId, "balanced lane should persist a model id").toBeTruthy();
    const patchedName = await balancedJack.locator("p").nth(1).textContent();
    expect(patchedName?.trim()).toBeTruthy();
    expect(patchedName).not.toBe("Empty");
    expect(jackName.length).toBeGreaterThan(3);

    // --- compile ----------------------------------------------------------
    await page.goto("/compile");
    await page.getByRole("button", { name: "Run the compiler" }).click();
    await expect(page.getByRole("heading", { name: "Result" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("policy-compiler@1.0.0").first()).toBeVisible();

    // --- agent API mutation (mutating tool through the console) ------------
    await page.goto("/agent");
    await expect(page.getByRole("heading", { name: "Agent API console" })).toBeVisible();
    const rpcResponse = page.getByRole("region", { name: "JSON-RPC response" }).locator("pre");

    await page.getByLabel("Method").selectOption("initialize");
    await page.getByRole("button", { name: "Send call" }).click();
    await expect(rpcResponse).toContainText("protocolVersion", { timeout: 20_000 });

    // On narrow viewports the button sits below the fold, so bring it into
    // view explicitly rather than relying on Playwright's scroll heuristics.
    const sendCall = page.getByRole("button", { name: "Send call" });
    await page.getByLabel("Method").selectOption("tools/list");
    await expect(sendCall).toBeEnabled();
    await sendCall.scrollIntoViewIfNeeded();
    await sendCall.click();
    await expect(rpcResponse).toContainText("verify_integrity", { timeout: 20_000 });

    await page.getByLabel("Method").selectOption("tools/call");
    await page.getByLabel("MCP tool").selectOption("compile_policy");
    await page.getByLabel("Target agent").selectOption({ label: `browser-agent-${stamp}` });
    await expect(sendCall).toBeEnabled();
    await sendCall.scrollIntoViewIfNeeded();
    await sendCall.click();
    await expect(rpcResponse).toContainText("factors", { timeout: 30_000 });

    await page.getByLabel("MCP tool").selectOption("upsert_agent");
    await expect(sendCall).toBeEnabled();
    await sendCall.scrollIntoViewIfNeeded();
    await sendCall.click();
    await expect(rpcResponse).toContainText("revision", { timeout: 30_000 });

    // --- export -----------------------------------------------------------
    await page.goto("/export");
    const exportSelect = page.locator("#export-agent");
    const exportOption = exportSelect
      .locator("option")
      .filter({ hasText: `browser-agent-${stamp}` })
      .first();
    await exportSelect.selectOption((await exportOption.getAttribute("value")) ?? "");
    await expect(page.getByText("Manifest preview")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save manifest JSON" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toContain(`patchbay-browser-agent-${stamp}-manifest.json`);

    // --- verify the chain before deleting ----------------------------------
    await page.goto("/verify");
    await expect(page.getByText("all chains clean")).toBeVisible({ timeout: 30_000 });

    // --- delete ------------------------------------------------------------
    await page.goto(agentUrl);
    await page.getByRole("button", { name: "Delete agent" }).click();
    await page.waitForURL(/\/agents$/);
    await expect(page.getByText(`browser-agent-${stamp}`)).toHaveCount(0);

    // --- gone from the API too --------------------------------------------
    const api = await page.request.get(`/api/agents/${agentId}`);
    expect(api.status()).toBe(404);

    const realErrors = errors.filter(
      (line) => !/favicon|Failed to load resource.*404|net::ERR_/i.test(line),
    );
    expect(realErrors, `console errors: ${realErrors.join(" | ")}`).toEqual([]);
  });

  test("shared nav and footer expose the real repository link", async ({ page }) => {
    await page.goto("/");
    const headerLink = page.locator("header").getByRole("link", { name: /GitHub/i }).first();
    await expect(headerLink).toHaveAttribute("href", "https://github.com/aniruddhaadak80/patchbay");
    await expect(headerLink).toHaveAttribute("rel", /noopener/);

    const footerLink = page.locator("footer").getByRole("link", { name: /Star on GitHub/i }).first();
    await expect(footerLink).toHaveAttribute("href", "https://github.com/aniruddhaadak80/patchbay");
  });

  test("catalog labels its source honestly and states are truthful", async ({ page }) => {
    await page.goto("/catalog");
    await expect(page.getByRole("heading", { name: "Live model catalog" })).toBeVisible();
    await expect(page.getByText(/Live|Offline sample/).first()).toBeVisible();
    const upstream = page.locator('a[href^="https://openrouter.ai"], a[href^="https://models.dev"]');
    await expect(upstream.first()).toBeVisible();
    expect(await upstream.count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByText(/\$0\./).first()).toBeVisible();
  });

  test("vault rejects a malformed key and reports the real reason", async ({ page }) => {
    await page.goto("/keys");
    await page.getByLabel("Provider").selectOption("anthropic");
    await page.getByLabel("Label").fill("bad-key");
    await page.getByLabel("Key").fill("sk-openai-lookalike-123456");
    await page.getByRole("button", { name: "Store" }).click();
    // Scope to the form's own alert: Next.js also renders a live-route announcer.
    const formAlert = page.getByRole("region", { name: "Add a credential" }).getByRole("alert");
    await expect(formAlert).toContainText("sk-ant-", { timeout: 20_000 });
  });

  test("keyboard focus reaches primary controls and the skip link works", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });
});