import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Only dashboard and auth routes; the public website and /api/service-request stay untouched.
export const config = {
  matcher: ["/dashboard/:path*", "/login", "/auth/:path*"],
};
