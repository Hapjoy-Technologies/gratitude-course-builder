import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type BunnyVideoCreateResponse = {
  guid?: string;
  title?: string;
};

function allowedDomain() {
  return process.env.NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN || "gratefulness.me";
}

async function assertAdmin() {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress || "";
  if (!email.endsWith(`@${allowedDomain()}`)) {
    return false;
  }
  return true;
}

export async function POST(request: Request) {
  if (!(await assertAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 401 });
  }

  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libraryId || !apiKey) {
    return NextResponse.json(
      { error: "Bunny Stream env is missing" },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const title = String(formData.get("title") || "").trim();
  const collectionId = String(formData.get("collectionId") || "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Video file is required" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "Video title is required" }, { status: 400 });
  }

  const createResponse = await fetch(
    `https://video.bunnycdn.com/library/${libraryId}/videos`,
    {
      method: "POST",
      headers: {
        AccessKey: apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        ...(collectionId ? { collectionId } : {}),
      }),
    },
  );

  if (!createResponse.ok) {
    return NextResponse.json(
      { error: await createResponse.text() },
      { status: createResponse.status },
    );
  }

  const created = (await createResponse.json()) as BunnyVideoCreateResponse;
  const videoId = created.guid;
  if (!videoId) {
    return NextResponse.json(
      { error: "Bunny did not return a video id" },
      { status: 502 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const uploadResponse = await fetch(
    `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`,
    {
      method: "PUT",
      headers: {
        AccessKey: apiKey,
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    },
  );

  if (!uploadResponse.ok) {
    return NextResponse.json(
      { error: await uploadResponse.text(), videoId },
      { status: uploadResponse.status },
    );
  }

  return NextResponse.json({ videoId, title, collectionId });
}
