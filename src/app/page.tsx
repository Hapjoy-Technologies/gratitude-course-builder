"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import type { ApiEnvelope, Course, CourseDay, CourseDayItem, CourseDownloadable, CourseDownloadableItem, CourseSummary } from "@/lib/types";

const API_BASE = (process.env.NEXT_PUBLIC_COURSES_API_BASE_URL || "https://api-dev.gratefulness.me").replace(/\/$/, "");
const ADMIN_DOMAIN = process.env.NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN || "gratefulness.me";
const CLERK_READY = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const emptyCourseForm = {
  name: "",
  description: "",
  authorId: "gratitude",
  isPaid: false,
  thumbnailUrl: "",
};

const emptyDayForm = {
  dayId: "day-1",
  dayNumber: 1,
  title: "Day 1",
  description: "",
  thumbnailUrl: "",
  textContent: "",
  contentFormat: "markdown",
};

const emptyItemForm = {
  dayId: "day-1",
  itemId: "",
  type: "video",
  order: 1,
  title: "",
  description: "",
  durationSeconds: 0,
  requiredForCompletion: true,
  videoId: "",
};

const emptyPromptForm = {
  dayId: "day-1",
  title: "Prompt for today",
  order: 99,
  textContent: "",
  contentFormat: "markdown",
  requiredForCompletion: true,
};

const emptyDownloadableForm = {
  assetId: "",
  title: "",
  type: "file",
  url: "",
  unlockAfter: "day-1",
  order: 1,
};

type DownloadableUploadResponse = {
  assetId: string;
  uploadUrl: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  expiresIn: number;
  downloadable: CourseDownloadable;
};

async function apiRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || payload.success === false) {
    const err = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(err || `Request failed with HTTP ${response.status}`);
  }
  return (payload.data ?? payload) as T;
}

function secondsToLabel(seconds?: number) {
  if (!seconds) return "-";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function sortItems(items: CourseDayItem[]) {
  return [...items].sort((a, b) => a.order - b.order || a.itemId.localeCompare(b.itemId));
}

function nextItemOrder(items: CourseDayItem[] = []) {
  return Math.max(0, ...items.map((item) => item.order || 0)) + 1;
}

function nextDownloadableOrder(downloadables: CourseDownloadable[] = [], unlockAfter = "course") {
  return Math.max(0, ...downloadables.filter((item) => item.unlockAfter === unlockAfter).map((item) => item.order || 0)) + 1;
}

function findCourseDownloadable(course: Course | null, assetId: string) {
  return (course?.downloadables || []).find((item) => item.assetId === assetId) || null;
}

function downloadableDayOptions(course: Course | null, currentUnlockAfter = "") {
  const options = (course?.days || [])
    .filter((day) => day.dayNumber > 0)
    .map((day) => ({ value: day.dayId, label: `${day.title || `Day ${day.dayNumber}`}` }));

  if (options.length === 0) {
    options.push({ value: "day-1", label: "Day 1" });
  }

  if (currentUnlockAfter && !options.some((option) => option.value === currentUnlockAfter)) {
    options.push({ value: currentUnlockAfter, label: currentUnlockAfter });
  }

  return options;
}

function downloadableUnlockLabel(unlockAfter: string, days: CourseDay[]) {
  const day = days.find((item) => item.dayId === unlockAfter);
  if (day) return `${day.title || `Day ${day.dayNumber}`} reward`;
  return unlockAfter === "course" ? "Course completion reward" : `${unlockAfter} reward`;
}

function downloadableUnlockRank(unlockAfter: string, days: CourseDay[]) {
  const day = days.find((item) => item.dayId === unlockAfter);
  if (day) return day.dayNumber;
  const match = unlockAfter.match(/^day-(\d+)$/);
  if (match) return Number(match[1]);
  return unlockAfter === "course" ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER - 1;
}

function downloadablesForDay(downloadables: CourseDownloadable[] = [], dayId: string) {
  return downloadables
    .filter((item) => item.unlockAfter === dayId)
    .sort((a, b) => a.order - b.order || a.assetId.localeCompare(b.assetId));
}

function downloadableTypeForFile(file: File) {
  const value = `${file.type} ${file.name}`.toLowerCase();
  if (value.includes("image/") || /\.(jpe?g|png|webp)$/.test(value)) return "image";
  if (value.includes("pdf") || value.endsWith(".pdf")) return "pdf";
  if (value.includes("zip") || value.endsWith(".zip")) return "zip";
  return "file";
}

function courseDays(course: Course | null) {
  return [...(course?.introVideos || []), ...(course?.days || [])];
}

function findCourseDay(course: Course | null, dayId: string) {
  return courseDays(course).find((day) => day.dayId === dayId) || null;
}

function findCourseDayItem(course: Course | null, dayId: string, itemId: string, videoId?: string) {
  const day = findCourseDay(course, dayId);
  if (!day) return null;
  return day.items.find((item) => {
    if (itemId && item.itemId === itemId) return true;
    return Boolean(videoId && item.videoId && item.videoId === videoId);
  }) || null;
}

type EditorMode = "course" | "day" | "video" | "text" | "downloadable";

export default function Home() {
  if (!CLERK_READY) {
    return <CoursesAdmin email={`local-dev@${ADMIN_DOMAIN}`} />;
  }

  return <ClerkHome />;
}

function ClerkHome() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <Loader2 className="animate-spin text-[#e94b76]" />
      </main>
    );
  }

  if (!isSignedIn) {
    return <AuthScreen />;
  }

  return <AdminGate />;
}

function AuthScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f9] px-6">
      <section className="w-full max-w-md rounded border border-[#d8dce5] bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded bg-[#e94b76] text-white">
            <ShieldCheck size={21} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Gratitude Course Admin</h1>
            <p className="text-sm text-[#6b7280]">Sign in with your @{ADMIN_DOMAIN} account.</p>
          </div>
        </div>
        <SignInButton mode="modal">
          <button className="h-11 w-full rounded bg-[#20232d] px-4 text-sm font-semibold text-white hover:bg-[#343948]">
            Sign in
          </button>
        </SignInButton>
      </section>
    </main>
  );
}

function AdminGate() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress || "";
  const allowed = email.endsWith(`@${ADMIN_DOMAIN}`);

  if (!allowed) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <section className="w-full max-w-lg rounded border border-[#f0c6d2] bg-white p-8">
          <h1 className="text-xl font-semibold">Admin access only</h1>
          <p className="mt-2 text-sm text-[#6b7280]">Use an @{ADMIN_DOMAIN} email to edit course content.</p>
          <div className="mt-6"><UserButton /></div>
        </section>
      </main>
    );
  }

  return <CoursesAdmin email={email} />;
}

function CoursesAdmin({ email }: { email: string }) {
  const [token, setToken] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("coursesAdminToken") || "",
  );
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [course, setCourse] = useState<Course | null>(null);
  const [courseForm, setCourseForm] = useState(emptyCourseForm);
  const [dayForm, setDayForm] = useState(emptyDayForm);
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [promptForm, setPromptForm] = useState(emptyPromptForm);
  const [downloadableForm, setDownloadableForm] = useState(emptyDownloadableForm);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [downloadableFiles, setDownloadableFiles] = useState<File[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>("course");
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [message, setMessage] = useState("Ready");

  const selectedDay = useMemo(() => {
    if (!course) return null;
    return findCourseDay(course, itemForm.dayId) || courseDays(course)[0] || null;
  }, [course, itemForm.dayId]);

  useEffect(() => {
    localStorage.setItem("coursesAdminToken", token);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setInitialLoading(true);
    setMessage("Loading courses");
    apiRequest<{ courses: CourseSummary[] }>("/v1/courses", token)
      .then((data) => {
        if (cancelled) return;
        const nextCourses = data.courses || [];
        setCourses(nextCourses);
        if (!selectedCourseId && nextCourses[0]) {
          return loadCourse(nextCourses[0].courseId);
        }
        setMessage("Ready");
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Failed to load courses");
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    setMessage(label);
    try {
      await action();
      setMessage(`${label} done`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadCourses() {
    const data = await apiRequest<{ courses: CourseSummary[] }>("/v1/courses", token);
    const nextCourses = data.courses || [];
    setCourses(nextCourses);
    if (!course && nextCourses[0]) {
      await loadCourse(nextCourses[0].courseId);
    }
  }

  async function loadCourse(courseId: string) {
    setSelectedCourseId(courseId);
    const data = await apiRequest<{ course: Course }>(`/v1/courses/${courseId}/admin`, token);
    setCourse(data.course);
    setCourseForm({
      name: data.course.name || "",
      description: data.course.description || "",
      authorId: data.course.authorId || "gratitude",
      isPaid: data.course.isPaid || false,
      thumbnailUrl: data.course.thumbnailUrl || "",
    });
    setEditorMode("course");
    const firstDay = data.course.days[0];
    if (firstDay) {
      setDayForm({
        dayId: firstDay.dayId,
        dayNumber: firstDay.dayNumber,
        title: firstDay.title,
        description: firstDay.description || "",
        thumbnailUrl: firstDay.thumbnailUrl || "",
        textContent: firstDay.textContent || "",
        contentFormat: firstDay.contentFormat || "markdown",
      });
      setItemForm((value) => ({ ...value, dayId: firstDay.dayId, order: (firstDay.items?.length || 0) + 1 }));
      setPromptForm((value) => ({ ...value, dayId: firstDay.dayId, textContent: firstDay.textContent || "" }));
      const firstRewardDay = downloadableDayOptions(data.course)[0]?.value || "day-1";
      setDownloadableForm((value) => ({
        ...value,
        unlockAfter: firstRewardDay,
        order: nextDownloadableOrder(data.course.downloadables, firstRewardDay),
      }));
    }
  }

  function editCourse() {
    setEditorMode("course");
  }

  function editDay(day: CourseDay) {
    setDayForm({
      dayId: day.dayId,
      dayNumber: day.dayNumber,
      title: day.title,
      description: day.description || "",
      thumbnailUrl: day.thumbnailUrl || "",
      textContent: day.textContent || "",
      contentFormat: day.contentFormat || "markdown",
    });
    setPromptForm((value) => ({ ...value, dayId: day.dayId, textContent: day.textContent || "" }));
    setItemForm((value) => ({ ...value, dayId: day.dayId, order: (day.items?.length || 0) + 1 }));
    setEditorMode("day");
  }

  function addVideoToDay(day: CourseDay) {
    setItemForm({
      ...emptyItemForm,
      dayId: day.dayId,
      order: nextItemOrder(day.items),
    });
    setVideoFile(null);
    setEditorMode("video");
  }

  function editItem(day: CourseDay, item: CourseDayItem) {
    if (item.type === "prompt") {
      setPromptForm({
        dayId: day.dayId,
        title: item.title || "Prompt for today",
        order: item.order || nextItemOrder(day.items),
        textContent: day.textContent || "",
        contentFormat: day.contentFormat || "markdown",
        requiredForCompletion: item.requiredForCompletion,
      });
      setEditorMode("text");
      return;
    }

    setItemForm({
      dayId: day.dayId,
      itemId: item.itemId,
      type: item.type || "video",
      order: item.order,
      title: item.title,
      description: item.description || "",
      durationSeconds: item.durationSeconds || 0,
      requiredForCompletion: item.requiredForCompletion,
      videoId: item.videoId || "",
    });
    setVideoFile(null);
    setEditorMode("video");
  }

  function addTextToDay(day: CourseDay) {
    setPromptForm({
      ...emptyPromptForm,
      dayId: day.dayId,
      order: nextItemOrder(day.items),
      textContent: day.textContent || "",
      contentFormat: day.contentFormat || "markdown",
    });
    setEditorMode("text");
  }

  function addDownloadableToDay(day: CourseDay) {
    setDownloadableForm({
      ...emptyDownloadableForm,
      unlockAfter: day.dayId,
      order: nextDownloadableOrder(course?.downloadables, day.dayId),
    });
    setDownloadableFiles([]);
    setEditorMode("downloadable");
  }

  function editDownloadable(downloadable: CourseDownloadable) {
    setDownloadableForm({
      assetId: downloadable.assetId,
      title: downloadable.title,
      type: downloadable.type || "file",
      url: downloadable.url || "",
      unlockAfter: downloadable.unlockAfter || downloadableDayOptions(course)[0]?.value || "day-1",
      order: downloadable.order || nextDownloadableOrder(course?.downloadables, downloadable.unlockAfter || "day-1"),
    });
    setDownloadableFiles([]);
    setEditorMode("downloadable");
  }

  async function createCourse(event: FormEvent) {
    event.preventDefault();
    await run("Creating course", async () => {
      const data = await apiRequest<{ course: Course }>("/v1/courses", token, {
        method: "POST",
        body: JSON.stringify(courseForm),
      });
      await loadCourses();
      await loadCourse(data.course.courseId);
    });
  }

  async function saveCourse(event: FormEvent) {
    event.preventDefault();
    if (!course) return;
    await run("Saving course", async () => {
      const nextCourse = {
        name: courseForm.name.trim() || course.name,
        description: courseForm.description.trim() || course.description || "",
        authorId: courseForm.authorId.trim() || course.authorId || "gratitude",
        isPaid: courseForm.isPaid,
        thumbnailUrl: courseForm.thumbnailUrl.trim() || course.thumbnailUrl || "",
      };
      await apiRequest(`/v1/courses/${course.courseId}`, token, {
        method: "PUT",
        body: JSON.stringify(nextCourse),
      });
      await loadCourse(course.courseId);
      await loadCourses();
    });
  }

  async function deleteCourse() {
    if (!course || !confirm(`Delete ${course.name} from DynamoDB?`)) return;
    await run("Deleting course", async () => {
      await apiRequest(`/v1/courses/${course.courseId}`, token, { method: "DELETE" });
      setCourse(null);
      setSelectedCourseId("");
      await loadCourses();
    });
  }

  async function syncBunny() {
    await run("Syncing Bunny", async () => {
      await apiRequest("/v1/courses/sync-bunny", token, { method: "POST", body: "{}" });
      await loadCourses();
      if (selectedCourseId) await loadCourse(selectedCourseId);
    });
  }

  async function saveDay(event: FormEvent) {
    event.preventDefault();
    if (!course) return;
    await run("Saving day", async () => {
      const existingDay = findCourseDay(course, dayForm.dayId);
      const nextDay = {
        ...dayForm,
        dayNumber: Number(dayForm.dayNumber) || existingDay?.dayNumber || 1,
        title: dayForm.title.trim() || existingDay?.title || `Day ${Number(dayForm.dayNumber) || 1}`,
        description: dayForm.description.trim() || existingDay?.description || "",
        thumbnailUrl: dayForm.thumbnailUrl.trim() || existingDay?.thumbnailUrl || "",
        textContent: dayForm.textContent.trim() || existingDay?.textContent || "",
        contentFormat: dayForm.contentFormat.trim() || existingDay?.contentFormat || "markdown",
      };
      await apiRequest(`/v1/courses/${course.courseId}/days/${dayForm.dayId}`, token, {
        method: "PUT",
        body: JSON.stringify(nextDay),
      });
      await loadCourse(course.courseId);
    });
  }

  async function uploadDownloadableFile(file: File, type = downloadableForm.type) {
    if (!course) throw new Error("Choose a course first");
    const formData = new FormData();
    formData.set("file", file);
    formData.set("courseId", course.courseId);
    formData.set("token", token);
    formData.set("title", file.name);
    formData.set("type", type || "file");

    const response = await fetch("/api/downloadables/upload", { method: "POST", body: formData });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Downloadable upload failed");
    return payload as DownloadableUploadResponse;
  }

  async function saveDownloadable(event: FormEvent) {
    event.preventDefault();
    if (!course) return;
    await run("Saving downloadable", async () => {
      const shouldCreatePlaylist = downloadableForm.type === "playlist" || downloadableFiles.length > 1;
      const uploadedFiles = downloadableFiles.length
        ? await Promise.all(downloadableFiles.map((file) => uploadDownloadableFile(file, shouldCreatePlaylist ? downloadableTypeForFile(file) : downloadableForm.type)))
        : [];
      const uploaded = !shouldCreatePlaylist && uploadedFiles.length === 1 ? uploadedFiles[0] : null;
      const existingDownloadables = course.downloadables || [];
      const assetId = downloadableForm.assetId || uploaded?.assetId || (shouldCreatePlaylist ? `playlist-${Date.now()}` : "");
      const existingDownloadable = findCourseDownloadable(course, assetId);
      const unlockAfter = downloadableForm.unlockAfter.trim() || existingDownloadable?.unlockAfter || downloadableDayOptions(course)[0]?.value || "day-1";
      const playlistItems: CourseDownloadableItem[] = shouldCreatePlaylist
        ? [
            ...(existingDownloadable?.items || []),
            ...uploadedFiles.map((fileUpload, index) => ({
              assetId: fileUpload.assetId,
              title: fileUpload.downloadable.title || downloadableFiles[index]?.name || `Reward ${index + 1}`,
              type: fileUpload.downloadable.type || "image",
              url: fileUpload.url || fileUpload.downloadable.url || "",
              order: (existingDownloadable?.items?.length || 0) + index + 1,
            })),
          ]
        : [];
      const nextDownloadable: CourseDownloadable = {
        assetId,
        title:
          downloadableForm.title.trim() ||
          uploaded?.downloadable.title ||
          existingDownloadable?.title ||
          downloadableFiles[0]?.name ||
          "Downloadable",
        type: shouldCreatePlaylist ? "playlist" : downloadableForm.type.trim() || uploaded?.downloadable.type || existingDownloadable?.type || "file",
        url: shouldCreatePlaylist ? existingDownloadable?.url || "" : downloadableForm.url.trim() || uploaded?.url || uploaded?.downloadable.url || existingDownloadable?.url || "",
        unlockAfter,
        order:
          Number(downloadableForm.order) ||
          existingDownloadable?.order ||
          nextDownloadableOrder(existingDownloadables, unlockAfter),
        ...(shouldCreatePlaylist ? { items: playlistItems } : {}),
      };
      if (!nextDownloadable.assetId || (nextDownloadable.type !== "playlist" && !nextDownloadable.url)) {
        throw new Error("Upload a file or provide an existing downloadable URL");
      }
      if (nextDownloadable.type === "playlist" && !nextDownloadable.items?.length) {
        throw new Error("Upload at least one file for this reward playlist");
      }

      const mergedDownloadables = [
        ...existingDownloadables.filter((item) => item.assetId !== nextDownloadable.assetId),
        nextDownloadable,
      ].sort((a, b) => {
        const rankDelta = downloadableUnlockRank(a.unlockAfter, course.days) - downloadableUnlockRank(b.unlockAfter, course.days);
        return rankDelta || a.order - b.order || a.assetId.localeCompare(b.assetId);
      });

      await apiRequest(`/v1/courses/${course.courseId}`, token, {
        method: "PUT",
        body: JSON.stringify({ downloadables: mergedDownloadables }),
      });
      setDownloadableForm(emptyDownloadableForm);
      setDownloadableFiles([]);
      await loadCourse(course.courseId);
    });
  }

  async function deleteDownloadable(assetId: string) {
    if (!course || !confirm(`Remove downloadable ${assetId} from this course?`)) return;
    await run("Deleting downloadable", async () => {
      const nextDownloadables = (course.downloadables || []).filter((item) => item.assetId !== assetId);
      await apiRequest(`/v1/courses/${course.courseId}`, token, {
        method: "PUT",
        body: JSON.stringify({ downloadables: nextDownloadables }),
      });
      await loadCourse(course.courseId);
    });
  }

  async function deleteDay(dayId: string) {
    if (!course || !confirm(`Delete ${dayId}?`)) return;
    await run("Deleting day", async () => {
      await apiRequest(`/v1/courses/${course.courseId}/days/${dayId}`, token, { method: "DELETE" });
      await loadCourse(course.courseId);
    });
  }

  async function uploadVideo() {
    if (!course || !videoFile) return null;
    const formData = new FormData();
    formData.set("file", videoFile);
    formData.set("title", itemForm.title || videoFile.name);
    formData.set("collectionId", course.courseId);
    const response = await fetch("/api/bunny/upload", { method: "POST", body: formData });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Bunny upload failed");
    setItemForm((value) => ({ ...value, videoId: payload.videoId, title: value.title || payload.title }));
    return payload as { videoId: string; title?: string };
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!course) return;
    await run("Saving item", async () => {
      const uploaded = videoFile && !itemForm.videoId ? await uploadVideo() : null;
      const existingItem = findCourseDayItem(course, itemForm.dayId, itemForm.itemId, itemForm.videoId);
      const nextItem = {
        dayId: itemForm.dayId,
        itemId: itemForm.itemId || existingItem?.itemId || "",
        type: itemForm.type || existingItem?.type || "video",
        order: Number(itemForm.order) || existingItem?.order || nextItemOrder(findCourseDay(course, itemForm.dayId)?.items || []),
        title: itemForm.title.trim() || uploaded?.title || videoFile?.name || existingItem?.title || "",
        description: itemForm.description.trim() || existingItem?.description || "",
        durationSeconds: Number(itemForm.durationSeconds) || existingItem?.durationSeconds || 0,
        requiredForCompletion: itemForm.requiredForCompletion,
        videoId: itemForm.videoId.trim() || uploaded?.videoId || existingItem?.videoId || "",
      };
      await apiRequest(`/v1/courses/${course.courseId}/items`, token, {
        method: "PUT",
        body: JSON.stringify({ items: [nextItem] }),
      });
      setItemForm(emptyItemForm);
      setVideoFile(null);
      await loadCourse(course.courseId);
    });
  }

  async function deleteItem(dayId: string, itemId: string) {
    if (!course || !confirm(`Delete ${itemId}?`)) return;
    await run("Deleting item", async () => {
      await apiRequest(`/v1/courses/${course.courseId}/days/${dayId}/items/${itemId}`, token, { method: "DELETE" });
      await loadCourse(course.courseId);
    });
  }

  async function savePrompt(event: FormEvent) {
    event.preventDefault();
    if (!course) return;
    await run("Saving text", async () => {
      const existingDay = findCourseDay(course, promptForm.dayId);
      const existingPrompt = existingDay?.items.find((item) => item.type === "prompt");
      const nextPrompt = {
        dayId: promptForm.dayId,
        title: promptForm.title.trim() || existingPrompt?.title || "Prompt for today",
        order: Number(promptForm.order) || existingPrompt?.order || 99,
        textContent: promptForm.textContent.trim() || existingDay?.textContent || "",
        contentFormat: promptForm.contentFormat.trim() || existingDay?.contentFormat || "markdown",
        requiredForCompletion: promptForm.requiredForCompletion,
      };
      await apiRequest(`/v1/courses/${course.courseId}/days/${promptForm.dayId}/prompt`, token, {
        method: "PUT",
        body: JSON.stringify(nextPrompt),
      });
      await loadCourse(course.courseId);
    });
  }

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-[#dfe3ea] bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded bg-[#e94b76] text-white"><BookOpen size={19} /></div>
            <div>
              <h1 className="text-lg font-semibold">Course Operations</h1>
              <p className="text-xs text-[#6b7280]">Signed in as {email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => run("Loading courses", loadCourses)} className="icon-button" title="Refresh courses"><RefreshCw size={17} /></button>
            {CLERK_READY ? <UserButton /> : <span className="rounded border border-[#d8dce5] px-2 py-1 text-xs font-semibold text-[#6b7280]">Dev</span>}
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-[300px_minmax(360px,1fr)_460px] gap-0">
        <aside className="border-r border-[#dfe3ea] bg-white p-4">
          <div className="mb-4 rounded border border-[#d8dce5] p-3">
            <label className="label">Backend admin bearer token</label>
            <textarea value={token} onChange={(e) => setToken(e.target.value)} className="field min-h-20 font-mono text-xs" placeholder="Paste Firebase/admin bearer token" />
          </div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Courses</h2>
            <button onClick={syncBunny} className="icon-button" title="Sync Bunny collections"><RefreshCw size={16} /></button>
          </div>
          <div className="space-y-2">
            {courses.map((item) => (
              <button key={item.courseId} onClick={() => run("Loading course", () => loadCourse(item.courseId))} className={`list-row text-left ${selectedCourseId === item.courseId ? "list-row-active" : ""}`}>
                <span className="font-medium">{item.name}</span>
                <span className="text-xs text-[#6b7280]">{item.dayCount} days</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="overflow-y-auto p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold">{course?.name || "New course"}</h2>
              <p className="text-sm text-[#6b7280]">{message}{busy ? "..." : ""}</p>
            </div>
            {(busy || initialLoading) && <Loader2 className="animate-spin text-[#e94b76]" />}
          </div>

          <div className="mb-5 rounded border border-[#dfe3ea] bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <button className="inline-flex items-center gap-2 text-left" onClick={editCourse}>
                <BookOpen size={18} className="text-[#e94b76]" />
                <span>
                  <span className="block text-sm font-semibold">Course metadata</span>
                  <span className="block text-xs text-[#6b7280]">Name, thumbnail, payment, author</span>
                </span>
              </button>
              <button className="secondary-button" onClick={editCourse}><Pencil size={15} /> Edit</button>
            </div>
          </div>

          {initialLoading && !course && (
            <div className="panel grid min-h-40 place-items-center text-sm font-semibold text-[#6b7280]">
              Loading course data...
            </div>
          )}

          {!initialLoading && !course && (
            <div className="panel grid min-h-40 place-items-center text-center">
              <div>
                <p className="text-sm font-semibold">No course selected</p>
                <p className="mt-1 text-xs text-[#6b7280]">Refresh courses or choose one from the list.</p>
              </div>
            </div>
          )}

          {course && (
            <div className="space-y-4">
              {!!course.introVideos?.length && (
                <CourseSection
                  title="Introduction"
                  days={course.introVideos}
                  downloadables={course.downloadables || []}
                  onEditDay={editDay}
                  onAddVideo={addVideoToDay}
                  onAddText={addTextToDay}
                  onAddDownloadable={addDownloadableToDay}
                  onEditItem={editItem}
                  onEditDownloadable={editDownloadable}
                  onDeleteItem={deleteItem}
                  onDeleteDownloadable={deleteDownloadable}
                  onDeleteDay={deleteDay}
                />
              )}
              <CourseSection
                title="Days"
                days={course.days}
                downloadables={course.downloadables || []}
                onEditDay={editDay}
                onAddVideo={addVideoToDay}
                onAddText={addTextToDay}
                onAddDownloadable={addDownloadableToDay}
                onEditItem={editItem}
                onEditDownloadable={editDownloadable}
                onDeleteItem={deleteItem}
                onDeleteDownloadable={deleteDownloadable}
                onDeleteDay={deleteDay}
              />
              <DownloadablesSection
                downloadables={course.downloadables || []}
                days={courseDays(course)}
                onEdit={editDownloadable}
                onDelete={deleteDownloadable}
              />
            </div>
          )}
        </section>

        <aside className="overflow-y-auto border-l border-[#dfe3ea] bg-white p-5">
          <div className="mb-4">
            <h3 className="text-base font-semibold">Editor</h3>
            <p className="text-xs text-[#6b7280]">Choose one operation, edit, save.</p>
          </div>

          <label className="label mb-4">
            Operation
            <select className="field" value={editorMode} onChange={(e) => setEditorMode(e.target.value as EditorMode)}>
              <option value="course">Course metadata</option>
              <option value="day">Day metadata</option>
              <option value="video">Video item</option>
              <option value="text">Text / prompt</option>
              <option value="downloadable">Downloadable</option>
            </select>
          </label>

          {editorMode === "course" && (
            <form onSubmit={course ? saveCourse : createCourse} className="panel">
              <div className="panel-heading"><BookOpen size={18} /> Course metadata</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="label col-span-2">Name<input className="field" value={courseForm.name} onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })} /></label>
                <label className="label col-span-2">Description<textarea className="field min-h-24" value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} /></label>
                <label className="label">Author<input className="field" value={courseForm.authorId} onChange={(e) => setCourseForm({ ...courseForm, authorId: e.target.value })} /></label>
                <label className="label">Thumbnail URL<input className="field" value={courseForm.thumbnailUrl} onChange={(e) => setCourseForm({ ...courseForm, thumbnailUrl: e.target.value })} /></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={courseForm.isPaid} onChange={(e) => setCourseForm({ ...courseForm, isPaid: e.target.checked })} /> Paid course</label>
              </div>
              <div className="mt-4 flex gap-2">
                <button className="primary-button" disabled={busy}><Save size={16} /> {course ? "Save course" : "Create course"}</button>
                {course && <button type="button" onClick={deleteCourse} className="danger-button"><Trash2 size={16} /> Delete</button>}
              </div>
            </form>
          )}

          {editorMode === "day" && (
            <form onSubmit={saveDay} className="panel">
              <div className="panel-heading"><Plus size={18} /> Day metadata</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="label">Day ID<input className="field" value={dayForm.dayId} onChange={(e) => setDayForm({ ...dayForm, dayId: e.target.value })} /></label>
                <label className="label">Day number<input type="number" className="field" value={dayForm.dayNumber} onChange={(e) => setDayForm({ ...dayForm, dayNumber: Number(e.target.value) })} /></label>
                <label className="label col-span-2">Title<input className="field" value={dayForm.title} onChange={(e) => setDayForm({ ...dayForm, title: e.target.value })} /></label>
                <label className="label col-span-2">Text content<textarea className="field min-h-32" value={dayForm.textContent} onChange={(e) => setDayForm({ ...dayForm, textContent: e.target.value })} /></label>
              </div>
              <button className="primary-button mt-4" disabled={!course || busy}><Save size={16} /> Save day</button>
            </form>
          )}

          {editorMode === "video" && (
            <form onSubmit={saveItem} className="panel">
              <div className="panel-heading"><Video size={18} /> Video item</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="label">Day ID<input className="field" value={itemForm.dayId} onChange={(e) => setItemForm({ ...itemForm, dayId: e.target.value })} /></label>
                <label className="label">Order<input type="number" className="field" value={itemForm.order} onChange={(e) => setItemForm({ ...itemForm, order: Number(e.target.value) })} /></label>
                <label className="label col-span-2">Title<input className="field" value={itemForm.title} onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })} /></label>
                <label className="label col-span-2">Item ID<input className="field" value={itemForm.itemId} onChange={(e) => setItemForm({ ...itemForm, itemId: e.target.value })} placeholder="Leave empty for auto item id" /></label>
                <label className="label col-span-2">Video ID<input className="field" value={itemForm.videoId} onChange={(e) => setItemForm({ ...itemForm, videoId: e.target.value })} /></label>
                <label className="label col-span-2">Upload video to Bunny<input type="file" accept="video/*" className="file-field" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} /></label>
                <label className="label">Duration seconds <span className="text-xs font-medium text-[#6b7280]">(auto from Bunny)</span><input type="number" className="field bg-[#f6f7f9] text-[#6b7280]" value={itemForm.durationSeconds} disabled readOnly /></label>
                <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={itemForm.requiredForCompletion} onChange={(e) => setItemForm({ ...itemForm, requiredForCompletion: e.target.checked })} /> Required</label>
                <label className="label col-span-2">Description<textarea className="field min-h-24" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} /></label>
              </div>
              <button className="primary-button mt-4" disabled={!course || busy}><Upload size={16} /> Save video item</button>
            </form>
          )}

          {editorMode === "text" && (
            <form onSubmit={savePrompt} className="panel">
              <div className="panel-heading"><FileText size={18} /> Text / prompt</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="label">Day ID<input className="field" value={promptForm.dayId} onChange={(e) => setPromptForm({ ...promptForm, dayId: e.target.value })} /></label>
                <label className="label">Order<input type="number" className="field" value={promptForm.order} onChange={(e) => setPromptForm({ ...promptForm, order: Number(e.target.value) })} /></label>
                <label className="label col-span-2">Title<input className="field" value={promptForm.title} onChange={(e) => setPromptForm({ ...promptForm, title: e.target.value })} /></label>
                <label className="label col-span-2">Markdown text<textarea className="field min-h-40" value={promptForm.textContent} onChange={(e) => setPromptForm({ ...promptForm, textContent: e.target.value })} /></label>
              </div>
              <button className="primary-button mt-4" disabled={!course || busy}><Save size={16} /> Save text</button>
            </form>
          )}

          {editorMode === "downloadable" && (
            <form onSubmit={saveDownloadable} className="panel">
              <div className="panel-heading"><Download size={18} /> Reward</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="label col-span-2">
                  Unlock after
                  <select
                    className="field"
                    value={downloadableForm.unlockAfter}
                    onChange={(event) => {
                      const unlockAfter = event.target.value;
                      setDownloadableForm({
                        ...downloadableForm,
                        unlockAfter,
                        order: downloadableForm.assetId
                          ? downloadableForm.order
                          : nextDownloadableOrder(course?.downloadables, unlockAfter),
                      });
                    }}
                  >
                    {downloadableDayOptions(course, downloadableForm.unlockAfter).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="label col-span-2">Title<input className="field" value={downloadableForm.title} onChange={(e) => setDownloadableForm({ ...downloadableForm, title: e.target.value })} /></label>
                <label className="label">Type
                  <select className="field" value={downloadableForm.type} onChange={(e) => setDownloadableForm({ ...downloadableForm, type: e.target.value })}>
                    <option value="file">File</option>
                    <option value="image">Image</option>
                    <option value="pdf">PDF</option>
                    <option value="zip">ZIP</option>
                    <option value="playlist">Playlist</option>
                  </select>
                </label>
                <label className="label">Order<input type="number" min="1" className="field" value={downloadableForm.order} onChange={(e) => setDownloadableForm({ ...downloadableForm, order: Number(e.target.value) })} /></label>
                <label className="label col-span-2">
                  Upload file(s)
                  <input
                    type="file"
                    multiple
                    accept="image/*,application/pdf,.zip"
                    className="file-field"
                    onChange={(event) => {
                      const files = Array.from(event.target.files || []);
                      setDownloadableFiles(files);
                      if (files.length > 1) {
                        setDownloadableForm((current) => ({
                          ...current,
                          type: "playlist",
                          title: current.title || "Reward playlist",
                        }));
                      } else if (files.length === 1 && downloadableForm.type === "playlist") {
                        setDownloadableForm((current) => ({
                          ...current,
                          title: current.title || files[0].name,
                        }));
                      }
                    }}
                  />
                </label>
                {downloadableFiles.length > 0 && (
                  <div className="col-span-2 rounded border border-[#e1e5ee] bg-[#f8fafc] p-3">
                    <div className="mb-2 text-xs font-semibold text-[#4b5563]">
                      {downloadableFiles.length > 1 ? `Playlist files (${downloadableFiles.length})` : "Selected file"}
                    </div>
                    <div className="space-y-1">
                      {downloadableFiles.map((file, index) => (
                        <div key={`${file.name}-${file.lastModified}`} className="flex items-center justify-between gap-3 text-xs text-[#6b7280]">
                          <span className="truncate">{index + 1}. {file.name}</span>
                          <span className="shrink-0 uppercase">{downloadableTypeForFile(file)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <label className="label col-span-2">Existing URL<input className="field" value={downloadableForm.url} onChange={(e) => setDownloadableForm({ ...downloadableForm, url: e.target.value })} placeholder="Filled automatically after upload" /></label>
              </div>
              <button className="primary-button mt-4" disabled={!course || busy}><Upload size={16} /> Save reward</button>
            </form>
          )}

          {selectedDay && <p className="mt-4 text-xs text-[#6b7280]">Selected day: {selectedDay.title}</p>}
        </aside>
      </div>
    </main>
  );
}

function CourseSection({ title, days, downloadables, onEditDay, onAddVideo, onAddText, onAddDownloadable, onEditItem, onEditDownloadable, onDeleteItem, onDeleteDownloadable, onDeleteDay }: {
  title: string;
  days: CourseDay[];
  downloadables: CourseDownloadable[];
  onEditDay: (day: CourseDay) => void;
  onAddVideo: (day: CourseDay) => void;
  onAddText: (day: CourseDay) => void;
  onAddDownloadable: (day: CourseDay) => void;
  onEditItem: (day: CourseDay, item: CourseDayItem) => void;
  onEditDownloadable: (downloadable: CourseDownloadable) => void;
  onDeleteItem: (dayId: string, itemId: string) => void;
  onDeleteDownloadable: (assetId: string) => void;
  onDeleteDay: (dayId: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#6b7280]">{title}</h3>
        <span className="text-xs font-semibold text-[#7b6f78]">{days.length} {days.length === 1 ? "group" : "groups"}</span>
      </div>
      <div className="space-y-2">
        {days.map((day) => {
          const dayDownloadables = downloadablesForDay(downloadables, day.dayId);
          return (
          <details key={day.dayId} className="tree-node" open={day.dayNumber <= 2 || day.dayId.startsWith("intro-")}>
            <summary className="tree-summary">
              <span className="tree-chevron"><ChevronDown size={16} /></span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{day.title || day.dayId}</span>
                <span className="block text-xs text-[#6b7280]">
                  {day.dayId} · {day.items.length} items{dayDownloadables.length ? ` · ${dayDownloadables.length} rewards` : ""}
                </span>
              </span>
              <span className="tree-actions">
                <button type="button" className="small-button" onClick={(event) => { event.preventDefault(); onEditDay(day); }}><Pencil size={14} /> Day</button>
                <button type="button" className="small-button" onClick={(event) => { event.preventDefault(); onAddVideo(day); }}><Video size={14} /> Video</button>
                <button type="button" className="small-button" onClick={(event) => { event.preventDefault(); onAddText(day); }}><FileText size={14} /> Text</button>
                <button type="button" className="small-button" onClick={(event) => { event.preventDefault(); onAddDownloadable(day); }}><Download size={14} /> Reward</button>
                <button type="button" className="icon-button compact" onClick={(event) => { event.preventDefault(); onDeleteDay(day.dayId); }} title="Delete day"><Trash2 size={14} /></button>
              </span>
            </summary>
            <div className="tree-items">
              {sortItems(day.items).map((item) => (
                <div key={item.itemId} className="tree-item">
                  {item.type === "prompt" ? <FileText size={18} className="text-[#7b6f78]" /> : <Video size={18} className="text-[#e94b76]" />}
                  <button className="min-w-0 text-left" onClick={() => onEditItem(day, item)}>
                    <div className="text-sm font-medium">{item.order}. {item.title}</div>
                    <div className="text-xs text-[#6b7280]">{item.itemId} · {item.type} · {secondsToLabel(item.durationSeconds)}</div>
                  </button>
                  <button className="icon-button compact" onClick={() => onDeleteItem(day.dayId, item.itemId)} title="Delete item"><Trash2 size={14} /></button>
                </div>
              ))}
              {dayDownloadables.map((downloadable) => (
                <div key={downloadable.assetId} className="tree-item">
                  <Download size={18} className="text-[#e94b76]" />
                  <button className="min-w-0 text-left" onClick={() => onEditDownloadable(downloadable)}>
                    <div className="text-sm font-medium">{downloadable.order}. {downloadable.title}</div>
                    <div className="text-xs text-[#6b7280]">
                      {downloadable.assetId} · reward · {downloadable.type}
                      {downloadable.items?.length ? ` · ${downloadable.items.length} files` : ""}
                    </div>
                  </button>
                  <button className="icon-button compact" onClick={() => onDeleteDownloadable(downloadable.assetId)} title="Delete reward"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </details>
        )})}
      </div>
    </section>
  );
}

function DownloadablesSection({ downloadables, days, onEdit, onDelete }: {
  downloadables: CourseDownloadable[];
  days: CourseDay[];
  onEdit: (downloadable: CourseDownloadable) => void;
  onDelete: (assetId: string) => void;
}) {
  const sortedDownloadables = [...downloadables].sort((a, b) => {
    const rankDelta = downloadableUnlockRank(a.unlockAfter, days) - downloadableUnlockRank(b.unlockAfter, days);
    return rankDelta || a.order - b.order || a.assetId.localeCompare(b.assetId);
  });

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#6b7280]">Rewards</h3>
        <span className="text-xs font-semibold text-[#7b6f78]">{sortedDownloadables.length} files</span>
      </div>
      <div className="tree-node">
        {sortedDownloadables.length === 0 ? (
          <div className="p-4 text-sm text-[#6b7280]">No rewards added yet.</div>
        ) : (
          <div className="tree-items border-t-0">
            {sortedDownloadables.map((downloadable) => (
              <div key={downloadable.assetId} className="tree-item">
                <Download size={18} className="text-[#e94b76]" />
                <button className="min-w-0 text-left" onClick={() => onEdit(downloadable)}>
                  <div className="text-sm font-medium">{downloadable.order}. {downloadable.title}</div>
                  <div className="text-xs text-[#6b7280]">
                    {downloadableUnlockLabel(downloadable.unlockAfter, days)} · {downloadable.type}
                    {downloadable.items?.length ? ` · ${downloadable.items.length} files` : ""}
                  </div>
                </button>
                <button className="icon-button compact" onClick={() => onDelete(downloadable.assetId)} title="Delete reward"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
