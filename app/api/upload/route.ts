import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

const allowedContentTypes = ["application/pdf", "image/jpeg", "image/png"];
const maxFileSize = 5 * 1024 * 1024;
const uploadWindows = new Map<string, { count: number; resetAt: number }>();

function allowUpload(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const current = uploadWindows.get(ip);
  if (!current || current.resetAt <= now) {
    uploadWindows.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= 10;
}

export async function POST(request: Request) {
  if (!allowUpload(request)) return NextResponse.json({ status: "rate_limited", message: "Too many uploads. Please try again later." }, { status: 429 });
  try {
    const body = await request.json() as HandleUploadBody;
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^service-requests\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]+$/i.test(pathname)) throw new Error("Invalid upload path");
        const safeName = pathname.split("/").pop() ?? "upload";
        return {
          allowedContentTypes,
          maximumSizeInBytes: maxFileSize,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ safeName }),
        };
      },
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ status: "upload_failed", message }, { status: 400 });
  }
}
