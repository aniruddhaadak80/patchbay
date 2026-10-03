import { errorResponse, successResponse, throttleWrite, zodMessage, credentialSchema } from "@/lib/api";
import {
  ConflictError,
  createCredential,
  deleteCredential,
  listCredentials,
  ValidationError,
} from "@/lib/db/repository";
import { ensureScopeRow, getOrCreateScopeId } from "@/lib/scope";
import { sealSecret, validateSecretFormat } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ownerId = await getOrCreateScopeId();
  const credentials = await listCredentials(ownerId);
  return successResponse({
    credentials,
    note: "Keys are stored AES-256-GCM encrypted and are never returned by this API. Only the label, last four characters, and a ciphertext fingerprint are exposed.",
  });
}

export async function POST(request: Request) {
  const ownerId = await getOrCreateScopeId();
  await ensureScopeRow(ownerId);
  const throttle = throttleWrite(`credentials:${ownerId}`);
  if (!throttle.allowed) {
    return errorResponse(429, "rate_limited", `Too many writes. Retry in ${throttle.retryAfter}s.`);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
  }
  const parsed = credentialSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(400, "invalid_input", zodMessage(parsed.error), parsed.error.flatten());
  }

  const secret = parsed.data.secret.trim();
  const formatError = validateSecretFormat(parsed.data.provider, secret);
  if (formatError) {
    return errorResponse(400, "invalid_key_format", formatError, { provider: parsed.data.provider });
  }

  const sealed = sealSecret(secret);
  try {
    const stored = await createCredential({
      ownerId,
      provider: parsed.data.provider,
      label: parsed.data.label,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      fingerprint: sealed.fingerprint,
      last4: sealed.last4,
    });
    return successResponse(
      { credential: stored, stored: true, keyValueReturned: false },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ConflictError) return errorResponse(409, error.code, error.message);
    if (error instanceof ValidationError) return errorResponse(400, error.code, error.message);
    return errorResponse(500, "store_failed", "Could not store the credential.");
  }
}

export async function DELETE(request: Request) {
  const ownerId = await getOrCreateScopeId();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return errorResponse(400, "missing_id", "Provide the credential id in ?id=.");
  const throttle = throttleWrite(`credentials:${ownerId}`);
  if (!throttle.allowed) {
    return errorResponse(429, "rate_limited", `Too many writes. Retry in ${throttle.retryAfter}s.`);
  }
  try {
    await deleteCredential(ownerId, id);
    return successResponse({ id, deleted: true });
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") {
      return errorResponse(404, "not_found", error.message);
    }
    return errorResponse(500, "delete_failed", "Could not delete the credential.");
  }
}