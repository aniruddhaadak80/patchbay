import { expect, test } from "@playwright/test";

/**
 * Captures the product screenshot used in the README.
 *
 * It drives the real product: creates an agent, patches two lanes through the
 * patch bay, and captures the page with a live compiled policy on it. No
 * fixtures and no seeded data are inserted.
 */
test("capture the agent page", async ({ page }) => {
  const stamp = Date.now().toString().slice(-6);

  await page.setViewportSize({ width: 1440, height: 1180 });

  await page.goto("/agents/new");
  await page.getByLabel("Agent name").fill(`readme-tour-${stamp}`);
  await page
    .getByLabel("Task class")
    .fill("Route inbound support tickets to the cheapest adequate model and escalate the hard ones.");

  const fast = page.getByLabel("Fast lane model");
  await fast.selectOption((await fast.locator("option").nth(1).getAttribute("value")) ?? "");
  const deep = page.getByLabel("Deep lane model");
  await deep.selectOption((await deep.locator("option").nth(24).getAttribute("value")) ?? "");

  await page.getByRole("button", { name: "Create agent" }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}$/);

  // Patch the balanced lane through the patch bay so the capture shows a real
  // cord between a catalog jack and a lane jack.
  const jack = page.getByRole("button", { name: /MTok in/ }).nth(9);
  await jack.click();
  const patchButton = page.getByRole("button", { name: "Patch here" }).nth(1);
  await patchButton.scrollIntoViewIfNeeded();
  await patchButton.click();
  await expect(page.getByRole("status")).toContainText("balanced", { timeout: 60_000 });
  await page.waitForLoadState("networkidle");

  const route = page.url().split("/agents/")[1];
  await page.screenshot({ path: "docs/screenshot-agent.png", fullPage: false });

  // Leave no proof data behind in a shared database.
  await page.request.delete(`/api/agents/${route}`);
  expect(page.url()).toContain("/agents/");
});