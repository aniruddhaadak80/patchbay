/**
 * Warms the server before any test runs.
 *
 * The first request against the embedded database pays WASM startup and schema
 * migration, which is far slower than a normal page render. Without this, early
 * steps of the journey look like flaky timeouts rather than cold start. Against
 * a hosted database the same probe returns in milliseconds.
 *
 * The server itself is started by Playwright's `webServer` block.
 */
export default async function globalSetup(): Promise<void> {
  const baseURL =
    process.env.PATCHBAY_BASE_URL ??
    `http://127.0.0.1:${process.env.PATCHBAY_PORT ?? 3100}`;

  const deadline = Date.now() + 300_000;
  let lastError = "no response yet";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) {
        const body = (await response.json()) as {
          data?: {
            status?: string;
            adapter?: string;
            checks?: { persistence?: { roundTrip?: string } };
          };
        };
        if (body.data?.checks?.persistence?.roundTrip === "ok") {
          // One page render, so the first test navigation does not pay module
          // initialisation on top of everything else.
          await fetch(`${baseURL}/`);
          await fetch(`${baseURL}/agents`);
          process.stdout.write(
            `warm: health ${body.data.status} on ${body.data.adapter}, persistence round trip ok\n`,
          );
          return;
        }
        lastError = `persistence round trip ${body.data?.checks?.persistence?.roundTrip}`;
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Server at ${baseURL} never became healthy: ${lastError}`);
}