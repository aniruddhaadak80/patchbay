/**
 * Proxy (edge middleware) mints the anonymous scope cookie.
 *
 * Cookies may only be written from a Route Handler or Server Action, never from
 * a Server Component, so the cookie is issued here and the scope helper only ever
 * reads it. The signature is verified again server-side, so a forged cookie
 * grants nothing.
 */

import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "patchbay_scope";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

function secret(): string {
  const configured = process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (configured && configured.length >= 16) return configured;
  if (process.env.NODE_ENV === "production") {
    // A fixed fallback keeps the app bootable; production must set AUTH_SECRET
    // so scope cookies and stored credentials cannot be forged offline.
    return "patchbay-missing-auth-secret-production-must-set-this";
  }
  return "patchbay-local-development-scope-secret";
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function proxy(request: NextRequest) {
  const existing = request.cookies.get(COOKIE_NAME)?.value;
  if (existing && existing.includes(".")) return NextResponse.next();

  const id = `anon_${crypto.randomUUID().replace(/-/g, "")}`;
  const response = NextResponse.next();
  response.cookies.set(COOKIE_NAME, `${id}.${await sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export const config = {
  // Static assets and the MCP manifest are excluded: they need no scope and must
  // answer without a cookie round trip.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|mcp.json|opengraph-image).*)"],
};