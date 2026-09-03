import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function apiBase() {
  return (process.env.NEXT_PUBLIC_COURSES_API_BASE_URL || "https://api-dev.gratefulness.me").replace(/\/$/, "");
}

function allowedDomain() {
  return process.env.NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN || "gratefulness.me";
}

async function assertAdmin() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return true;
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress || "";
  return email.endsWith(`@${allowedDomain()}`);
}

export async function POST(request: Request) {
  if (!(await assertAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const courseId = String(formData.get("courseId") || "").trim();
  const token = String(formData.get("token") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const type = String(formData.get("type") || "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Downloadable file is required" }, { status: 400 });
  }
  if (!courseId) {
    return NextResponse.json({ error: "Course id is required" }, { status: 400 });
  }

  const createUploadResponse = await fetch(`${apiBase()}/v1/courses/${courseId}/downloadables/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      ...(title ? { title } : {}),
      ...(type ? { type } : {}),
    }),
  });

  const uploadPayload = await createUploadResponse.json().catch(() => ({}));
  if (!createUploadResponse.ok || uploadPayload.success === false) {
    return NextResponse.json(
      { error: uploadPayload.error?.message || "Could not create upload URL", details: uploadPayload },
      { status: createUploadResponse.status },
    );
  }

  const data = uploadPayload.data || uploadPayload;
  const uploadResponse = await fetch(data.uploadUrl, {
    method: data.method || "PUT",
    headers: data.headers || { "Content-Type": file.type || "application/octet-stream" },
    body: Buffer.from(await file.arrayBuffer()),
  });

  if (!uploadResponse.ok) {
    return NextResponse.json(
      { error: `S3 upload failed with HTTP ${uploadResponse.status}` },
      { status: uploadResponse.status },
    );
  }

  return NextResponse.json(data);
}
