import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Better Auth handles every method under /api/auth/* itself. */
async function handle(request: Request): Promise<Response> {
  const auth = await getAuth();
  const handler = toNextJsHandler(auth.handler);
  switch (request.method.toUpperCase()) {
    case "GET":
      return handler.GET(request);
    case "POST":
      return handler.POST(request);
    case "PATCH":
      return handler.PATCH(request);
    case "PUT":
      return handler.PUT(request);
    case "DELETE":
      return handler.DELETE(request);
    default:
      return new Response(JSON.stringify({ error: { code: "method_not_allowed", message: "Unsupported method." } }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;