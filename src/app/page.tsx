"use client";

import { DragEvent, FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Ellipsis,
  Gift,
  GripVertical,
  KeyRound,
  Loader2,
  Lock,
  PenLine,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Rocket,
  Save,
  ShieldAlert,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { Upload as TusUpload } from "tus-js-client";
import type { ApiEnvelope, Course, CourseDay, CourseDayItem, CourseDownloadable, CourseDownloadableItem, CourseSummary } from "@/lib/types";

const API_BASE = (process.env.NEXT_PUBLIC_COURSES_API_BASE_URL || "https://api-dev.gratefulness.me").replace(/\/$/, "");
const PROD_API_BASE = (process.env.NEXT_PUBLIC_COURSES_PROD_API_BASE_URL || "").replace(/\/$/, "");

const REQUIRED_PASSWORD = "we_spread_gratitude";
const SESSION_STORAGE_KEY = "gratitude_courses_unlocked";

const emptyCourseForm = {
  order: 0,
  name: "",
  description: "",
  authorId: "gratitude",
  authorName: "Gratitude",
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

const emptyInstructionForm = {
  dayId: "day-1",
  itemId: "",
  title: "",
  order: 1,
  description: "",
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

type ThumbnailUploadResponse = {
  uploadUrl: string;
  thumbnailUrl: string;
  method: string;
  headers?: Record<string, string>;
  expiresIn: number;
};

type VideoUploadResponse = {
  videoId: string;
  title: string;
  uploadUrl: string;
  method: "TUS";
  headers: Record<string, string>;
  expiresIn: number;
};

async function putFileDirectly(file: File, upload: { uploadUrl: string; method?: string; headers?: Record<string, string> }) {
  const response = await fetch(upload.uploadUrl, {
    method: upload.method || "PUT",
    headers: upload.headers || { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Direct file upload failed with HTTP ${response.status}`);
  }
}

/** A pasted token without a leading "Bearer " or stray whitespace: the API adds "Bearer" itself. */
function normalizeToken(value: string): string {
  return value.replace(/\s+/g, "").replace(/^bearer/i, "");
}

const ADMIN_EMAIL_DOMAIN = "gratefulness.me";

type TokenStatus = { tone: "ok" | "warn"; text: string };

/**
 * What the pasted Firebase ID token says about who it belongs to. Read only for this hint: the
 * backend verifies the token and decides. Admins are verified Google accounts on gratefulness.me.
 */
function describeToken(token: string): TokenStatus | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const claims = JSON.parse(json) as {
      email?: string;
      email_verified?: boolean;
      exp?: number;
      firebase?: { sign_in_provider?: string };
    };
    if (claims.exp && claims.exp * 1000 < Date.now()) return { tone: "warn", text: "This token has expired. Copy a fresh one (they last about an hour)." };
    if (claims.firebase?.sign_in_provider === "anonymous") return { tone: "warn", text: "This token is from an anonymous user. Sign in with your @gratefulness.me Google account in the app first." };
    const email = claims.email?.toLowerCase() ?? "";
    if (!email) return { tone: "warn", text: "This token has no email. Sign in with your @gratefulness.me Google account." };
    const minutes = claims.exp ? Math.max(0, Math.round((claims.exp * 1000 - Date.now()) / 60000)) : null;
    const expiry = minutes === null ? "" : ` Expires in ${minutes} min.`;
    if (claims.email_verified && email.endsWith(`@${ADMIN_EMAIL_DOMAIN}`)) return { tone: "ok", text: `Signed in as ${email}: can promote.${expiry}` };
    return { tone: "warn", text: `Signed in as ${email}. Only verified @${ADMIN_EMAIL_DOMAIN} accounts can promote.${expiry}` };
  } catch {
    return { tone: "warn", text: "This doesn't look like a Firebase ID token." };
  }
}

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

async function productionApiRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  if (!PROD_API_BASE) throw new Error("Production API URL is not configured");
  const response = await fetch(`${PROD_API_BASE}${path}`, {
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
    throw new Error(err || `Production request failed with HTTP ${response.status}`);
  }
  return (payload.data ?? payload) as T;
}

type CoursePromotionReport = {
  courseId: string;
  courseName: string;
  mode: "dry-run" | "apply";
  sourceTable: string;
  targetTable: string;
  sourceBucket: string;
  targetBucket: string;
  objects: string[];
  objectsCopied: number;
  productionSaved: boolean;
};

function secondsToLabel(seconds?: number) {
  if (!seconds) return "-";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function sortItems(items: CourseDayItem[]) {
  return [...items].sort((a, b) => a.order - b.order || a.itemId.localeCompare(b.itemId));
}

function moveById<T>(items: T[], sourceId: string, targetId: string, getId: (item: T) => string) {
  const sourceIndex = items.findIndex((item) => getId(item) === sourceId);
  const targetIndex = items.findIndex((item) => getId(item) === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

function setDragData(event: DragEvent, kind: string, id: string, parentId = "") {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-course-order", JSON.stringify({ kind, id, parentId }));
  const dragSurface = (event.currentTarget as HTMLElement).closest<HTMLElement>(".list-row, .tree-summary, .tree-item, .playlist-order-row");
  dragSurface?.classList.add("is-dragging");
}

function clearDragStyle(event: DragEvent) {
  const dragSurface = (event.currentTarget as HTMLElement).closest<HTMLElement>(".list-row, .tree-summary, .tree-item, .playlist-order-row");
  dragSurface?.classList.remove("is-dragging");
}

function readDragData(event: DragEvent) {
  try {
    return JSON.parse(event.dataTransfer.getData("application/x-course-order")) as { kind: string; id: string; parentId: string };
  } catch {
    return null;
  }
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

async function compressThumbnail(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Thumbnail must be an image");
  }

  const image = await createImageBitmap(file);
  const maxSize = 1200;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare thumbnail image");
  }
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob) {
    throw new Error("Could not compress thumbnail image");
  }
  return new File([blob], `thumbnail-${Date.now()}.webp`, { type: "image/webp" });
}

function courseDays(course: Course | null) {
  return [...(course?.introVideos || []), ...(course?.days || [])];
}

function defaultIntroDay(course: Course): CourseDay {
  return {
    courseId: course.courseId,
    dayId: "intro-1",
    dayNumber: 0,
    title: "Introduction",
    description: "",
    thumbnailUrl: course.thumbnailUrl || "",
    textContent: "",
    contentFormat: "markdown",
    items: [],
  };
}

function introVideoDays(course: Course) {
  return course.introVideos?.length ? course.introVideos : [defaultIntroDay(course)];
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

type EditorMode = "course" | "day" | "video" | "text" | "instruction" | "downloadable";

export default function Home() {
  return <CoursesAdmin />;
}

function CoursesAdmin() {
  // Firebase ID token from a verified @gratefulness.me Google sign-in; production requires it for Promote.
  const [token, setToken] = useState(() =>
    typeof window === "undefined" ? "" : normalizeToken(localStorage.getItem("coursesAdminToken") || ""),
  );
  const tokenStatus = describeToken(token);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [course, setCourse] = useState<Course | null>(null);
  const [courseForm, setCourseForm] = useState(emptyCourseForm);
  const [dayForm, setDayForm] = useState(emptyDayForm);
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [promptForm, setPromptForm] = useState(emptyPromptForm);
  const [instructionForm, setInstructionForm] = useState(emptyInstructionForm);
  const [downloadableForm, setDownloadableForm] = useState(emptyDownloadableForm);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [downloadableFiles, setDownloadableFiles] = useState<File[]>([]);
  // What the editor panel shows; null keeps it closed until a lesson, day or action is picked.
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [dayIsNew, setDayIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [message, setMessage] = useState("Ready");
  const [orderToast, setOrderToast] = useState<{ id: number; text: string; tone?: "ok" | "error" } | null>(null);
  // Sync status shown in the header: saves so far, a quiet background refresh, or the last error.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [syncCount, setSyncCount] = useState(0);
  const [loadingCourseId, setLoadingCourseId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  // Each course's state in the published app (production API): true when disabled there. A course
  // missing from the map hasn't been promoted yet; null until production has been checked.
  const [publishedDisabled, setPublishedDisabled] = useState<Record<string, boolean> | null>(null);
  const [publishedError, setPublishedError] = useState<string | null>(null);
  // Courses already opened, so switching back is instant; each is refreshed in the background.
  const courseCache = useRef(new Map<string, Course>());
  const refreshSeq = useRef(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (saved === "true") {
        setIsUnlocked(true);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("coursesAdminToken", token);
  }, [token]);

  useEffect(() => {
    if (!orderToast) return;
    const timeout = window.setTimeout(() => setOrderToast(null), orderToast.tone === "error" ? 5000 : 2200);
    return () => window.clearTimeout(timeout);
  }, [orderToast]);

  useEffect(() => {
    if (!isUnlocked || !PROD_API_BASE || !token) return;
    let cancelled = false;
    productionApiRequest<{ courses: CourseSummary[] }>("/v1/courses/admin", token)
      .then((data) => {
        if (cancelled) return;
        setPublishedDisabled(Object.fromEntries((data.courses || []).map((item) => [item.courseId, Boolean(item.disabled)])));
        setPublishedError(null);
      })
      .catch((error) => {
        if (!cancelled) setPublishedError(error instanceof Error ? error.message : "Could not check the published app");
      });
    return () => {
      cancelled = true;
    };
  }, [isUnlocked, token]);

  // Menus close on an outside click; Escape closes a menu, then the editor.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest("[data-menu]")) setOpenMenu(null);
      if (!(event.target as HTMLElement).closest("[data-token]")) setTokenOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[data-menu] [aria-expanded="true"], [data-token] [aria-expanded="true"]')) {
        setOpenMenu(null);
        setTokenOpen(false);
      } else {
        setEditorMode(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);


  function handleUnlock(event: FormEvent) {
    event.preventDefault();
    if (passwordInput === REQUIRED_PASSWORD) {
      setIsUnlocked(true);
      setPasswordError("");
      setPasswordInput("");
      if (typeof window !== "undefined") {
        sessionStorage.setItem(SESSION_STORAGE_KEY, "true");
      }
    } else {
      setPasswordError("Incorrect password. Please try again.");
    }
  }

  function handleLock() {
    setIsUnlocked(false);
    setCourses([]);
    setCourse(null);
    setSelectedCourseId("");
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  async function run(label: string, action: () => Promise<void>, successToast?: string) {
    setBusy(true);
    setMessage(label);
    setLastError(null);
    try {
      await action();
      setSavedAt((count) => (count || 0) + 1);
      if (successToast) setOrderToast((current) => ({ id: (current?.id || 0) + 1, text: successToast }));
    } catch (error) {
      const text = error instanceof Error ? error.message : "Something failed";
      setLastError(text);
      setOrderToast((current) => ({ id: (current?.id || 0) + 1, text, tone: "error" }));
    } finally {
      setBusy(false);
    }
  }

  async function loadCourses() {
    const data = await apiRequest<{ courses: CourseSummary[] }>("/v1/courses/admin", token);
    const nextCourses = data.courses || [];
    setCourses(nextCourses);
    if (!course && !isCreatingCourse && nextCourses[0]) {
      await loadCourse(nextCourses[0].courseId);
    }
  }

  async function loadCourse(courseId: string) {
    setIsCreatingCourse(false);
    setSelectedCourseId(courseId);
    const data = await apiRequest<{ course: Course }>(`/v1/courses/${courseId}/admin`, token);
    courseCache.current.set(courseId, data.course);
    setCourse(data.course);
    setCourseForm({
      order: data.course.order ?? 0,
      name: data.course.name || "",
      description: data.course.description || "",
      authorId: data.course.authorId || "gratitude",
      authorName: data.course.authorName || data.course.authorId || "Gratitude",
      isPaid: data.course.isPaid || false,
      thumbnailUrl: data.course.thumbnailUrl || "",
    });
    setEditorMode(null);
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

  useEffect(() => {
    if (!isUnlocked) return;
    let cancelled = false;
    setInitialLoading(true);
    setMessage("Loading courses");
    apiRequest<{ courses: CourseSummary[] }>("/v1/courses/admin", token)
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
        if (!cancelled) setLastError(error instanceof Error ? error.message : "Failed to load courses");
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isUnlocked]);

  /**
   * Reloads a course quietly after a save, without closing the editor or moving the page. Only the
   * newest refresh is applied, so a slow older one can't undo a newer change.
   */
  async function refreshCourse(courseId: string) {
    const seq = ++refreshSeq.current;
    setSyncCount((count) => count + 1);
    try {
      const data = await apiRequest<{ course: Course }>(`/v1/courses/${courseId}/admin`, token);
      courseCache.current.set(courseId, data.course);
      if (seq === refreshSeq.current) {
        setCourse((current) => (current?.courseId === courseId ? data.course : current));
      }
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Could not refresh the course");
    } finally {
      setSyncCount((count) => count - 1);
    }
  }

  async function refreshCourseList() {
    setSyncCount((count) => count + 1);
    try {
      const data = await apiRequest<{ courses: CourseSummary[] }>("/v1/courses/admin", token);
      setCourses(data.courses || []);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Could not refresh the courses");
    } finally {
      setSyncCount((count) => count - 1);
    }
  }

  function refreshAll() {
    setLastError(null);
    void refreshCourseList();
    if (course) void refreshCourse(course.courseId);
  }

  /** Shows a saved change straight away; the background refresh then confirms it. */
  function patchCourse(update: (current: Course) => Course) {
    setCourse((current) => {
      if (!current) return current;
      const next = update(current);
      courseCache.current.set(next.courseId, next);
      return next;
    });
  }

  function patchDay(dayId: string, update: (day: CourseDay) => CourseDay) {
    const replace = (day: CourseDay) => (day.dayId === dayId ? update(day) : day);
    patchCourse((current) => ({ ...current, days: current.days.map(replace), introVideos: current.introVideos?.map(replace) }));
  }

  /** Puts a saved item in a day's list. A new item has a temporary id until the refresh brings the real one. */
  function upsertLocalItem(items: CourseDayItem[], item: CourseDayItem) {
    const exists = items.some((candidate) => candidate.itemId === item.itemId);
    const next = exists
      ? items.map((candidate) => (candidate.itemId === item.itemId ? item : candidate))
      : [...items, item];
    return sortItems(next);
  }

  function closeEditor() {
    setEditorMode(null);
  }

  async function openCourse(courseId: string) {
    if (courseId === selectedCourseId && course) return;
    setEditorMode(null);
    setOpenMenu(null);
    const cached = courseCache.current.get(courseId);
    if (cached) {
      setIsCreatingCourse(false);
      setSelectedCourseId(courseId);
      setCourse(cached);
      void refreshCourse(courseId);
      return;
    }
    setLoadingCourseId(courseId);
    try {
      await loadCourse(courseId);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Could not open the course");
    } finally {
      setLoadingCourseId(null);
    }
  }

  function editCourse() {
    if (course) {
      setCourseForm({
        order: course.order ?? 0,
        name: course.name || "",
        description: course.description || "",
        authorId: course.authorId || "gratitude",
        authorName: course.authorName || course.authorId || "Gratitude",
        isPaid: course.isPaid || false,
        thumbnailUrl: course.thumbnailUrl || "",
      });
      setThumbnailFile(null);
    }
    setEditorMode("course");
  }

  function startNewCourse() {
    setIsCreatingCourse(true);
    setSelectedCourseId("");
    setCourse(null);
    setCourseForm({ ...emptyCourseForm });
    setDayForm({ ...emptyDayForm });
    setItemForm({ ...emptyItemForm });
    setPromptForm({ ...emptyPromptForm });
    setDownloadableForm({ ...emptyDownloadableForm });
    setThumbnailFile(null);
    setVideoFile(null);
    setDownloadableFiles([]);
    setEditorMode("course");
    setMessage("Enter the new course details");
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
    setDayIsNew(false);
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

  function addDay() {
    if (!course) return;
    const dayNumber = Math.max(0, ...course.days.map((day) => day.dayNumber)) + 1;
    setDayForm({
      ...emptyDayForm,
      dayId: `day-${dayNumber}`,
      dayNumber,
      title: `Day ${dayNumber}`,
    });
    setDayIsNew(true);
    setEditorMode("day");
  }

  async function reorderCourses(sourceId: string, targetId: string) {
    const next = moveById(courses, sourceId, targetId, (item) => item.courseId)
      .map((item, index) => ({ ...item, order: index + 1 }));
    if (next === courses) return;
    setCourses(next);
    await run("Saving course order", async () => {
      try {
        await apiRequest("/v1/courses/order", token, {
          method: "PUT",
          body: JSON.stringify({ courses: next.map((item) => ({ courseId: item.courseId, order: item.order })) }),
        });
      } finally {
        void refreshCourseList();
      }
    }, "Course order updated");
  }

  async function reorderDays(sourceId: string, targetId: string) {
    if (!course) return;
    const ordered = [...course.days].sort((a, b) => a.dayNumber - b.dayNumber || a.dayId.localeCompare(b.dayId));
    const nextDays = moveById(ordered, sourceId, targetId, (day) => day.dayId)
      .map((day, index) => ({ ...day, dayNumber: index + 1 }));
    setCourse({ ...course, days: nextDays });
    await run("Saving day order", async () => {
      try {
        await apiRequest(`/v1/courses/${course.courseId}/order`, token, {
          method: "PUT",
          body: JSON.stringify({ days: nextDays.map((day) => ({ dayId: day.dayId, dayNumber: day.dayNumber })) }),
        });
      } finally {
        void refreshCourse(course.courseId);
      }
    }, "Day order updated");
  }

  async function reorderItems(dayId: string, sourceId: string, targetId: string) {
    if (!course) return;
    const day = findCourseDay(course, dayId);
    if (!day) return;
    const nextItems = moveById(sortItems(day.items), sourceId, targetId, (item) => item.itemId)
      .map((item, index) => ({ ...item, order: index + 1 }));
    const replaceDay = (candidate: CourseDay) => candidate.dayId === dayId ? { ...candidate, items: nextItems } : candidate;
    setCourse({ ...course, days: course.days.map(replaceDay), introVideos: course.introVideos?.map(replaceDay) });
    await run("Saving content order", async () => {
      try {
        await apiRequest(`/v1/courses/${course.courseId}/order`, token, {
          method: "PUT",
          body: JSON.stringify({ items: nextItems.map((item) => ({ dayId, itemId: item.itemId, order: item.order })) }),
        });
      } finally {
        void refreshCourse(course.courseId);
      }
    }, "Content order updated");
  }

  async function reorderDownloadables(dayId: string, sourceId: string, targetId: string) {
    if (!course) return;
    const group = downloadablesForDay(course.downloadables, dayId);
    const moved = moveById(group, sourceId, targetId, (item) => item.assetId)
      .map((item, index) => ({ ...item, order: index + 1 }));
    const byId = new Map(moved.map((item) => [item.assetId, item]));
    setCourse({ ...course, downloadables: (course.downloadables || []).map((item) => byId.get(item.assetId) || item) });
    await run("Saving reward order", async () => {
      try {
        await apiRequest(`/v1/courses/${course.courseId}/order`, token, {
          method: "PUT",
          body: JSON.stringify({ downloadables: moved.map((item) => ({ assetId: item.assetId, order: item.order })) }),
        });
      } finally {
        void refreshCourse(course.courseId);
      }
    }, "Reward order updated");
  }

  async function reorderDownloadableItems(parentAssetId: string, sourceId: string, targetId: string) {
    if (!course) return;
    const parent = findCourseDownloadable(course, parentAssetId);
    if (!parent?.items) return;
    const nextItems = moveById([...parent.items].sort((a, b) => a.order - b.order), sourceId, targetId, (item) => item.assetId)
      .map((item, index) => ({ ...item, order: index + 1 }));
    setCourse({ ...course, downloadables: (course.downloadables || []).map((item) => item.assetId === parentAssetId ? { ...item, items: nextItems } : item) });
    await run("Saving playlist order", async () => {
      try {
        await apiRequest(`/v1/courses/${course.courseId}/order`, token, {
          method: "PUT",
          body: JSON.stringify({ downloadableItems: nextItems.map((item) => ({ parentAssetId, assetId: item.assetId, order: item.order })) }),
        });
      } finally {
        void refreshCourse(course.courseId);
      }
    }, "Playlist order updated");
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
    if (item.type === "instruction") {
      setInstructionForm({
        dayId: day.dayId,
        itemId: item.itemId,
        title: item.title,
        order: item.order || nextItemOrder(day.items),
        description: item.description || "",
        requiredForCompletion: item.requiredForCompletion,
      });
      setEditorMode("instruction");
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

  function addInstructionToDay(day: CourseDay) {
    setInstructionForm({
      ...emptyInstructionForm,
      dayId: day.dayId,
      order: nextItemOrder(day.items),
    });
    setEditorMode("instruction");
  }

  // Moves the day's prompt into the instruction form. Saving it turns that prompt into an instruction
  // in place (same item id, so people's progress is kept) and clears the day's prompt text.
  function promptToInstruction() {
    const day = findCourseDay(course, promptForm.dayId);
    const prompt = day?.items.find((item) => item.type === "prompt");
    if (!day || !prompt) return;
    setInstructionForm({
      dayId: day.dayId,
      itemId: prompt.itemId,
      title: prompt.title === "Prompt for today" ? "" : prompt.title,
      order: prompt.order,
      description: day.textContent || "",
      requiredForCompletion: prompt.requiredForCompletion,
    });
    setEditorMode("instruction");
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
      if (thumbnailFile) {
        const thumbnailUpload = await uploadThumbnailFile(thumbnailFile, data.course.courseId);
        await apiRequest(`/v1/courses/${data.course.courseId}`, token, {
          method: "PUT",
          body: JSON.stringify({ thumbnailUrl: thumbnailUpload.thumbnailUrl }),
        });
      }
      setThumbnailFile(null);
      const coursesData = await apiRequest<{ courses: CourseSummary[] }>("/v1/courses/admin", token);
      setCourses(coursesData.courses || []);
      await loadCourse(data.course.courseId);
    });
  }

  async function uploadThumbnailFile(file: File, courseId = course?.courseId) {
    if (!courseId) throw new Error("Choose a course first");
    const compressed = await compressThumbnail(file);
    const upload = await apiRequest<ThumbnailUploadResponse>(`/v1/courses/${courseId}/thumbnail/upload`, token, {
      method: "POST",
      body: JSON.stringify({ fileName: compressed.name, contentType: compressed.type }),
    });
    await putFileDirectly(compressed, upload);
    return upload;
  }

  async function saveCourse(event: FormEvent) {
    event.preventDefault();
    if (!course) return;
    await run("Saving course", async () => {
      const thumbnailUpload = thumbnailFile ? await uploadThumbnailFile(thumbnailFile) : null;
      const nextCourse = {
        name: courseForm.name.trim() || course.name,
        description: courseForm.description.trim() || course.description || "",
        authorId: courseForm.authorId.trim() || course.authorId || "gratitude",
        authorName: courseForm.authorName.trim() || course.authorName || course.authorId || "Gratitude",
        isPaid: courseForm.isPaid,
        order: courseForm.order,
        thumbnailUrl: thumbnailUpload?.thumbnailUrl || courseForm.thumbnailUrl.trim() || course.thumbnailUrl || "",
      };
      await apiRequest(`/v1/courses/${course.courseId}`, token, {
        method: "PUT",
        body: JSON.stringify(nextCourse),
      });
      setThumbnailFile(null);
      patchCourse((current) => ({ ...current, ...nextCourse }));
      setCourses((current) => current.map((item) => (item.courseId === course.courseId ? { ...item, name: nextCourse.name, isPaid: nextCourse.isPaid, order: nextCourse.order } : item)));
      setEditorMode(null);
      void refreshCourse(course.courseId);
      void refreshCourseList();
    });
  }

  async function deleteCourse() {
    if (!course || !confirm(`Delete the course “${course.name}”? This can't be undone.`)) return;
    await run("Deleting course", async () => {
      await apiRequest(`/v1/courses/${course.courseId}`, token, { method: "DELETE" });
      courseCache.current.delete(course.courseId);
      setCourse(null);
      setSelectedCourseId("");
      setEditorMode(null);
      await loadCourses();
    });
  }

  /** Reads which courses are in the published app and whether they're disabled there. */
  async function loadPublishedStatus() {
    if (!PROD_API_BASE || !token) return;
    try {
      const data = await productionApiRequest<{ courses: CourseSummary[] }>("/v1/courses/admin", token);
      setPublishedDisabled(Object.fromEntries((data.courses || []).map((item) => [item.courseId, Boolean(item.disabled)])));
      setPublishedError(null);
    } catch (error) {
      setPublishedError(error instanceof Error ? error.message : "Could not check the published app");
    }
  }

  /**
   * Disables or enables the course in the published app only, with the production API's own course
   * update. The debug app (development) and everything else about the course stay as they are.
   */
  async function togglePublishedDisabled() {
    if (!course || !publishedDisabled || !(course.courseId in publishedDisabled)) return;
    const nextDisabled = !publishedDisabled[course.courseId];
    const question = nextDisabled
      ? `Disable “${course.name}” in the published app? People won't see it until you enable it again.`
      : `Enable “${course.name}” in the published app?`;
    if (!confirm(question)) return;
    await run(nextDisabled ? "Disabling in the published app" : "Enabling in the published app", async () => {
      await productionApiRequest(`/v1/courses/${course.courseId}`, token, {
        method: "PUT",
        body: JSON.stringify({ disabled: nextDisabled }),
      });
      setPublishedDisabled((current) => ({ ...(current || {}), [course.courseId]: nextDisabled }));
      void loadPublishedStatus();
    }, nextDisabled ? "Disabled in the published app" : "Enabled in the published app");
  }

  async function toggleCourseDisabled() {
    if (!course) return;
    const nextDisabled = !course.disabled;
    await run(nextDisabled ? "Disabling in the debug app" : "Enabling in the debug app", async () => {
      await apiRequest(`/v1/courses/${course.courseId}`, token, {
        method: "PUT",
        body: JSON.stringify({ disabled: nextDisabled }),
      });
      patchCourse((current) => ({ ...current, disabled: nextDisabled }));
      setCourses((current) => current.map((item) => (item.courseId === course.courseId ? { ...item, disabled: nextDisabled } : item)));
      void refreshCourse(course.courseId);
      void refreshCourseList();
    }, nextDisabled ? "Disabled in the debug app" : "Enabled in the debug app");
  }

  async function promoteCourse() {
    if (!course) return;
    await run("Checking production promotion", async () => {
      const preview = await productionApiRequest<CoursePromotionReport>(`/v1/courses/${course.courseId}/promote`, token, {
        method: "POST",
        body: JSON.stringify({ apply: false }),
      });
      const approved = window.confirm(
        `Promote “${preview.courseName}” to production?\n\n` +
        `${preview.objects.length} asset(s) will be copied. The production course record will be created or replaced. Development will not be changed.`,
      );
      if (!approved) throw new Error("Promotion cancelled");
      const confirmation = window.prompt(`Type the course ID to confirm:\n${course.courseId}`);
      if (confirmation !== course.courseId) throw new Error("Promotion cancelled: course ID did not match");
      const result = await productionApiRequest<CoursePromotionReport>(`/v1/courses/${course.courseId}/promote`, token, {
        method: "POST",
        body: JSON.stringify({ apply: true, confirmation }),
      });
      setOrderToast({ id: Date.now(), text: `Promoted to production: ${result.objectsCopied} assets copied` });
      void loadPublishedStatus();
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
      if (existingDay) {
        patchDay(nextDay.dayId, (day) => ({ ...day, ...nextDay }));
      } else {
        patchCourse((current) => ({ ...current, days: [...current.days, { ...nextDay, courseId: current.courseId, items: [] }] }));
      }
      setEditorMode(null);
      void refreshCourse(course.courseId);
    });
  }

  async function uploadDownloadableFile(file: File, type = downloadableForm.type) {
    if (!course) throw new Error("Choose a course first");
    const upload = await apiRequest<DownloadableUploadResponse>(`/v1/courses/${course.courseId}/downloadables/upload`, token, {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        title: file.name,
        type: type || "file",
      }),
    });
    await putFileDirectly(file, upload);
    return upload;
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
      const isExternalDownloadable = ["spotify", "external_link"].includes(downloadableForm.type.trim());
      const assetId = downloadableForm.assetId || uploaded?.assetId || (shouldCreatePlaylist ? `playlist-${Date.now()}` : isExternalDownloadable ? `link-${Date.now()}` : "");
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
      patchCourse((current) => ({ ...current, downloadables: mergedDownloadables }));
      setEditorMode(null);
      void refreshCourse(course.courseId);
    });
  }

  async function deleteDownloadable(assetId: string) {
    const title = findCourseDownloadable(course, assetId)?.title || assetId;
    if (!course || !confirm(`Remove the reward “${title}” from this course?`)) return;
    await run("Deleting downloadable", async () => {
      const nextDownloadables = (course.downloadables || []).filter((item) => item.assetId !== assetId);
      await apiRequest(`/v1/courses/${course.courseId}`, token, {
        method: "PUT",
        body: JSON.stringify({ downloadables: nextDownloadables }),
      });
      patchCourse((current) => ({ ...current, downloadables: nextDownloadables }));
      setEditorMode(null);
      void refreshCourse(course.courseId);
    });
  }

  async function deleteDay(dayId: string) {
    const day = findCourseDay(course, dayId);
    if (!course || !confirm(`Delete “${day?.title || dayId}” and all its lessons? This can't be undone.`)) return;
    await run("Deleting day", async () => {
      await apiRequest(`/v1/courses/${course.courseId}/days/${dayId}`, token, { method: "DELETE" });
      patchCourse((current) => ({
        ...current,
        days: current.days.filter((candidate) => candidate.dayId !== dayId),
        introVideos: current.introVideos?.filter((candidate) => candidate.dayId !== dayId),
      }));
      setEditorMode(null);
      void refreshCourse(course.courseId);
    });
  }

  async function uploadVideo() {
    if (!course || !videoFile) return null;
    const file = videoFile;
    const title = itemForm.title.trim() || file.name;
    const session = await apiRequest<VideoUploadResponse>(`/v1/courses/${course.courseId}/videos/upload`, token, {
      method: "POST",
      body: JSON.stringify({ title }),
    });

    await new Promise<void>((resolve, reject) => {
      const upload = new TusUpload(file, {
        endpoint: session.uploadUrl,
        headers: session.headers,
        retryDelays: [0, 1000, 3000, 5000],
        uploadSize: file.size,
        metadata: { filename: file.name, filetype: file.type || "application/octet-stream", title },
        onError: reject,
        onProgress: (uploaded, total) => setMessage(`Uploading video ${Math.round((uploaded / total) * 100)}%`),
        onSuccess: () => resolve(),
      });
      upload.start();
    });

    setItemForm((value) => ({ ...value, videoId: session.videoId, title: value.title || session.title }));
    return { videoId: session.videoId, title: session.title };
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!course) return;
    await run("Saving item", async () => {
      const isIntroItem = itemForm.dayId.startsWith("intro-");
      if (isIntroItem && !findCourseDay(course, itemForm.dayId)) {
        await apiRequest(`/v1/courses/${course.courseId}/days/${itemForm.dayId}`, token, {
          method: "PUT",
          body: JSON.stringify({
            ...defaultIntroDay(course),
            dayId: itemForm.dayId,
          }),
        });
      }
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
      const { dayId: savedDayId, ...savedItem } = nextItem;
      const localItem = { ...savedItem, itemId: savedItem.itemId || `pending-${Date.now()}` };
      patchDay(savedDayId, (day) => ({ ...day, items: upsertLocalItem(day.items, localItem) }));
      setEditorMode(null);
      void refreshCourse(course.courseId);
    });
  }

  async function deleteItem(dayId: string, itemId: string) {
    const title = findCourseDayItem(course, dayId, itemId)?.title || itemId;
    if (!course || !confirm(`Delete the lesson “${title}”? This can't be undone.`)) return;
    await run("Deleting item", async () => {
      await apiRequest(`/v1/courses/${course.courseId}/days/${dayId}/items/${itemId}`, token, { method: "DELETE" });
      patchDay(dayId, (day) => ({ ...day, items: day.items.filter((item) => item.itemId !== itemId) }));
      setEditorMode(null);
      void refreshCourse(course.courseId);
    });
  }

  async function saveInstruction(event: FormEvent) {
    event.preventDefault();
    if (!course) return;
    await run("Saving instruction", async () => {
      const existingDay = findCourseDay(course, instructionForm.dayId);
      await apiRequest(`/v1/courses/${course.courseId}/items`, token, {
        method: "PUT",
        body: JSON.stringify({
          items: [{
            dayId: instructionForm.dayId,
            itemId: instructionForm.itemId.trim(),
            type: "instruction",
            order: Number(instructionForm.order) || nextItemOrder(existingDay?.items || []),
            title: instructionForm.title.trim(),
            description: instructionForm.description.trim(),
            requiredForCompletion: instructionForm.requiredForCompletion,
          }],
        }),
      });
      const convertsPrompt = existingDay?.items.some((item) => item.itemId === instructionForm.itemId.trim() && item.type === "prompt");
      const localItemId = instructionForm.itemId.trim() || `pending-${Date.now()}`;
      patchDay(instructionForm.dayId, (day) => ({
        ...day,
        textContent: convertsPrompt ? "" : day.textContent,
        items: upsertLocalItem(day.items, {
          itemId: localItemId,
          type: "instruction",
          order: Number(instructionForm.order) || nextItemOrder(day.items),
          title: instructionForm.title.trim(),
          description: instructionForm.description.trim(),
          requiredForCompletion: instructionForm.requiredForCompletion,
        }),
      }));
      setInstructionForm(emptyInstructionForm);
      setEditorMode(null);
      void refreshCourse(course.courseId);
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
      patchDay(nextPrompt.dayId, (day) => ({
        ...day,
        textContent: nextPrompt.textContent,
        contentFormat: nextPrompt.contentFormat,
        items: upsertLocalItem(day.items, {
          itemId: existingPrompt?.itemId || `${nextPrompt.dayId}-prompt`,
          type: "prompt",
          order: nextPrompt.order,
          title: nextPrompt.title,
          requiredForCompletion: nextPrompt.requiredForCompletion,
        }),
      }));
      setEditorMode(null);
      void refreshCourse(course.courseId);
    });
  }

  const syncing = syncCount > 0;
  const allDays = course ? courseDays(course) : [];
  const dayIds = new Set(allDays.map((day) => day.dayId));
  const courseRewards = (course?.downloadables || [])
    .filter((item) => !dayIds.has(item.unlockAfter))
    .sort((a, b) => a.order - b.order || a.assetId.localeCompare(b.assetId));
  const promptDayHasPrompt = Boolean(findCourseDay(course, promptForm.dayId)?.items.some((item) => item.type === "prompt"));
  const convertingPrompt = findCourseDayItem(course, instructionForm.dayId, instructionForm.itemId)?.type === "prompt";
  const isLinkReward = ["spotify", "external_link"].includes(downloadableForm.type);
  const tokenChip = !token ? "Add sign-in token" : tokenStatus?.tone === "ok" ? "Signed in" : "Check token";
  const publishedState: "unknown" | "missing" | "disabled" | "enabled" =
    !course || !publishedDisabled ? "unknown" :
    !(course.courseId in publishedDisabled) ? "missing" :
    publishedDisabled[course.courseId] ? "disabled" : "enabled";
  const publishedLabel = { unknown: publishedError ? "Couldn't check" : token ? "Checking…" : "Add token to check", missing: "Not promoted yet", disabled: "Disabled", enabled: "Enabled" }[publishedState];
  const publishedPillClass = publishedState === "enabled" ? "status-pill-enabled" : publishedState === "disabled" ? "status-pill-off" : "status-pill-disabled";

  // The lesson or reward the editor is open on, highlighted in the list.
  const activeKey =
    editorMode === "video" && itemForm.itemId ? `${itemForm.dayId}:${itemForm.itemId}` :
    editorMode === "instruction" && instructionForm.itemId ? `${instructionForm.dayId}:${instructionForm.itemId}` :
    editorMode === "text" ? `${promptForm.dayId}:prompt` :
    editorMode === "downloadable" && downloadableForm.assetId ? `reward:${downloadableForm.assetId}` :
    editorMode === "day" && !dayIsNew ? `day:${dayForm.dayId}` : "";

  const editor = (() => {
    const dayText = (dayId: string) => {
      const day = findCourseDay(course, dayId);
      return day ? dayLabel(day) : dayId;
    };
    switch (editorMode) {
      case "course":
        return { kind: "course", icon: <BookOpen size={17} />, title: course ? "Course details" : "New course", context: course?.name || "Fill in the details, then create it", save: course ? "Save details" : "Create course", disabled: busy || !courseForm.name.trim() };
      case "day":
        return { kind: "day", icon: <Pencil size={17} />, title: dayIsNew ? "New day" : "Edit day", context: dayIsNew ? course?.name || "" : dayText(dayForm.dayId), save: dayIsNew ? "Add day" : "Save day", disabled: !course || busy };
      case "video":
        return { kind: "video", icon: <Video size={17} />, title: itemForm.itemId ? "Edit video" : "New video", context: dayText(itemForm.dayId), save: "Save video", disabled: !course || busy };
      case "text":
        return { kind: "prompt", icon: <PenLine size={17} />, title: promptDayHasPrompt ? "Edit prompt" : "New prompt", context: dayText(promptForm.dayId), save: "Save prompt", disabled: !course || busy };
      case "instruction":
        return { kind: "instruction", icon: <BookOpen size={17} />, title: convertingPrompt ? "Make it an instruction" : instructionForm.itemId ? "Edit instruction" : "New instruction", context: dayText(instructionForm.dayId), save: "Save instruction", disabled: !course || busy || !instructionForm.title.trim() || !instructionForm.description.trim() };
      case "downloadable":
        return { kind: "reward", icon: <Gift size={17} />, title: downloadableForm.assetId ? "Edit reward" : "New reward", context: downloadableForm.unlockAfter === "course" ? "Course reward" : `Unlocks after ${dayText(downloadableForm.unlockAfter)}`, save: "Save reward", disabled: !course || busy };
      default:
        return null;
    }
  })();

  function submitEditor(event: FormEvent) {
    switch (editorMode) {
      case "course": return course ? saveCourse(event) : createCourse(event);
      case "day": return saveDay(event);
      case "video": return saveItem(event);
      case "text": return savePrompt(event);
      case "instruction": return saveInstruction(event);
      case "downloadable": return saveDownloadable(event);
      default: event.preventDefault();
    }
  }


  return (
    <main className="min-h-screen">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <div className="brand-mark"><BookOpen size={18} /></div>
            <div className="brand-text">
              <h1>Course Builder</h1>
              <p>Gratitude app courses</p>
            </div>
          </div>
          <div className="header-actions">
            {isUnlocked && (
              <>
                <SyncStatus busy={busy} message={message} syncing={syncing} lastError={lastError} savedAt={savedAt} />
                <div className="token-wrap" data-token>
                  <button
                    type="button"
                    className={`token-chip token-${token ? tokenStatus?.tone || "warn" : "none"}`}
                    onClick={() => setTokenOpen((open) => !open)}
                    aria-expanded={tokenOpen}
                    title={tokenStatus?.text || "Paste a sign-in token to save changes"}
                  >
                    <KeyRound size={15} />
                    <span>{tokenChip}</span>
                  </button>
                  {tokenOpen && (
                    <div className="token-popover">
                      <label className="label">
                        Sign-in token
                        <textarea value={token} onChange={(e) => setToken(normalizeToken(e.target.value))} className="field min-h-24 font-mono text-xs" placeholder="Paste the Firebase ID token from your @gratefulness.me Google sign-in" />
                      </label>
                      {tokenStatus && <p className={`token-status ${tokenStatus.tone === "ok" ? "text-emerald-700" : "text-amber-700"}`}>{tokenStatus.text}</p>}
                      <p className="hint">Needed to save changes and to promote. Tokens last about an hour.</p>
                    </div>
                  )}
                </div>
                <button type="button" onClick={refreshAll} className="icon-button" title="Refresh" aria-label="Refresh">
                  <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
                </button>
                <button type="button" onClick={handleLock} className="icon-button" title="Lock" aria-label="Lock">
                  <Lock size={16} />
                </button>
              </>
            )}
            <span className="environment-badge">Dev</span>
          </div>
        </div>
      </header>

      {orderToast && (
        <div key={orderToast.id} className={`order-toast ${orderToast.tone === "error" ? "order-toast-error" : ""}`} role="status" aria-live="polite">
          {orderToast.tone === "error" ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}
          {orderToast.text}
        </div>
      )}

      {!isUnlocked ? (
        <div className="flex min-h-[calc(100vh-60px)] items-center justify-center p-6 bg-[#f5f7f5]">
          <div className="w-full max-w-md rounded-xl border border-[#dce5e0] bg-white p-8 shadow-xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#fde9ed] text-[#df5c79]">
              <Lock size={28} />
            </div>
            <h2 className="text-center text-xl font-bold text-[#27312d]">Security Gate</h2>
            <p className="mt-1 text-center text-xs text-[#6b7280]">
              Course operations are protected. Please enter the access password to continue.
            </p>

            <form onSubmit={handleUnlock} className="mt-6 space-y-4">
              <div>
                <label className="label mb-1.5 block">Access Password</label>
                <input
                  type="password"
                  autoFocus
                  className="field"
                  placeholder="Enter password..."
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    if (passwordError) setPasswordError("");
                  }}
                />
                {passwordError && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[#b83b59]">
                    <ShieldAlert size={14} />
                    {passwordError}
                  </p>
                )}
              </div>

              <button type="submit" className="primary-button w-full py-2.5 text-sm font-semibold">
                Unlock Course Operations
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className={`course-workspace ${editorMode ? "editor-open" : ""}`}>
          <aside className="course-sidebar" aria-label="Courses">
            <div className="sidebar-head">
              <h2 className="section-title">Courses</h2>
              <button type="button" onClick={startNewCourse} className="small-button"><Plus size={14} /> New</button>
            </div>
            <div className="course-list">
              {courses.map((item) => (
                <button
                  key={item.courseId}
                  type="button"
                  draggable={!busy}
                  onDragStart={(event) => setDragData(event, "course", item.courseId)}
                  onDragEnd={clearDragStyle}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dragged = readDragData(event);
                    if (dragged?.kind === "course") void reorderCourses(dragged.id, item.courseId);
                  }}
                  onClick={() => void openCourse(item.courseId)}
                  className={`list-row ${selectedCourseId === item.courseId ? "list-row-active" : ""}`}
                >
                  <span className="list-row-top">
                    <GripVertical size={14} className="list-row-grip" />
                    <span className="list-row-name">{item.name}</span>
                    {loadingCourseId === item.courseId && <Loader2 size={14} className="animate-spin text-[#df5c79]" />}
                  </span>
                  <span className="list-row-meta">
                    {item.dayCount} {item.dayCount === 1 ? "day" : "days"} · {item.isPaid ? "Paid" : "Free"}
                    {item.disabled && <span className="status-pill status-pill-disabled">Disabled</span>}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="course-content">
            <div className="course-picker">
              <select className="field" value={selectedCourseId} onChange={(e) => e.target.value && void openCourse(e.target.value)} aria-label="Course">
                {!selectedCourseId && <option value="">{isCreatingCourse ? "New course" : "Choose a course"}</option>}
                {courses.map((item) => <option key={item.courseId} value={item.courseId}>{item.name}</option>)}
              </select>
              <button type="button" onClick={startNewCourse} className="secondary-button"><Plus size={15} /> New</button>
            </div>

            {initialLoading && !course && (
              <div className="empty-card"><Loader2 className="animate-spin text-[#df5c79]" size={20} /> Loading courses…</div>
            )}

            {!initialLoading && !course && !isCreatingCourse && (
              <div className="empty-card">Choose a course to edit it.</div>
            )}

            {isCreatingCourse && (
              <div className="empty-card">
                <BookOpen className="text-[#df5c79]" size={22} />
                <p className="font-semibold text-[#27312d]">New course</p>
                <p>Fill in the details, then create it. Days and lessons come next.</p>
              </div>
            )}

            {course && (
              <>
                <div className="course-hero">
                  <div className="course-hero-main">
                    <div className="course-thumb" style={course.thumbnailUrl ? { backgroundImage: `url("${course.thumbnailUrl}")` } : undefined}>
                      {!course.thumbnailUrl && <BookOpen size={22} />}
                    </div>
                    <div className="min-w-0">
                      <h2>{course.name}</h2>
                      <p className="course-hero-meta">
                        {course.days.length} {course.days.length === 1 ? "day" : "days"} · {course.isPaid ? "Paid" : "Free"} · By {course.authorName || course.authorId}
                      </p>
                      <p className="course-hero-status">
                        <span className={`status-pill ${course.disabled ? "status-pill-off" : "status-pill-enabled"}`} title="The debug app uses the development backend this builder edits.">
                          Debug app: {course.disabled ? "Disabled" : "Enabled"}
                        </span>
                        {PROD_API_BASE && (
                          <span className={`status-pill ${publishedPillClass}`} title={publishedError || "The published app uses the production backend. Promote copies this course there."}>
                            Published app: {publishedLabel}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="course-hero-actions">
                    <button type="button" className="secondary-button" onClick={editCourse}><Pencil size={15} /> Edit details</button>
                    <button type="button" className="secondary-button" onClick={promoteCourse} disabled={busy || !PROD_API_BASE} title={!PROD_API_BASE ? "Configure NEXT_PUBLIC_COURSES_PROD_API_BASE_URL" : "Copy this course and its files to production"}>
                      <Rocket size={15} /> <span>Promote<span className="hide-sm"> to production</span></span>
                    </button>
                    <Menu id="course" label="Course options" iconOnly icon={<Ellipsis size={16} />} openMenu={openMenu} setOpenMenu={setOpenMenu}>
                      <button type="button" role="menuitem" className="menu-item" onClick={toggleCourseDisabled} disabled={busy}><Power size={15} /> {course.disabled ? "Enable in debug app" : "Disable in debug app"}</button>
                      {PROD_API_BASE && (
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-item"
                          onClick={togglePublishedDisabled}
                          disabled={busy || publishedState === "unknown" || publishedState === "missing"}
                          title={publishedState === "missing" ? "Promote the course first" : publishedState === "unknown" ? "Add a sign-in token to check the published app" : undefined}
                        >
                          <Power size={15} /> {publishedState === "disabled" ? "Enable in published app" : "Disable in published app"}
                        </button>
                      )}
                      <button type="button" role="menuitem" className="menu-item menu-item-danger" onClick={deleteCourse}><Trash2 size={15} /> Delete course</button>
                    </Menu>
                  </div>
                </div>

                <div className="intro-gap" />
                {introVideoDays(course).map((day) => (
                  <DayCard
                    key={day.dayId}
                    day={day}
                    rewards={[]}
                    intro
                    defaultOpen
                    openMenu={openMenu}
                    setOpenMenu={setOpenMenu}
                    activeKey={activeKey}
                    onEditDay={editDay}
                    onDeleteDay={deleteDay}
                    onAddVideo={addVideoToDay}
                    onAddPrompt={addTextToDay}
                    onAddInstruction={addInstructionToDay}
                    onAddReward={addDownloadableToDay}
                    onEditItem={editItem}
                    onDeleteItem={deleteItem}
                    onEditReward={editDownloadable}
                    onDeleteReward={deleteDownloadable}
                    onReorderItem={reorderItems}
                  />
                ))}

                <div className="section-head">
                  <h3>Days <span className="count">{course.days.length}</span></h3>
                  <button type="button" className="secondary-button" onClick={addDay}><Plus size={15} /> New day</button>
                </div>
                {course.days.length === 0 && <div className="empty-card">No days yet. Add the first day.</div>}
                <div className="day-list">
                  {course.days.map((day) => (
                    <DayCard
                      key={day.dayId}
                      day={day}
                      rewards={downloadablesForDay(course.downloadables, day.dayId)}
                      defaultOpen={day.dayNumber <= 2}
                      onReorderDay={reorderDays}
                      onReorderReward={reorderDownloadables}
                      openMenu={openMenu}
                      setOpenMenu={setOpenMenu}
                      activeKey={activeKey}
                      onEditDay={editDay}
                      onDeleteDay={deleteDay}
                      onAddVideo={addVideoToDay}
                      onAddPrompt={addTextToDay}
                      onAddInstruction={addInstructionToDay}
                      onAddReward={addDownloadableToDay}
                      onEditItem={editItem}
                      onDeleteItem={deleteItem}
                      onEditReward={editDownloadable}
                      onDeleteReward={deleteDownloadable}
                      onReorderItem={reorderItems}
                    />
                  ))}
                </div>

                {courseRewards.length > 0 && (
                  <>
                    <div className="section-head">
                      <h3>Course rewards</h3>
                    </div>
                    <div className="tree-node day-card">
                      <div className="tree-items">
                        {courseRewards.map((downloadable) => (
                          <RewardRow
                            key={downloadable.assetId}
                            downloadable={downloadable}
                            active={activeKey === `reward:${downloadable.assetId}`}
                            onEdit={editDownloadable}
                            onDelete={deleteDownloadable}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </section>

          {editorMode && <div className="editor-backdrop" onClick={closeEditor} aria-hidden />}
          <aside className={`course-editor ${editorMode ? "is-open" : ""}`} aria-label="Editor">
            {!editor ? (
              <div className="editor-empty">
                <PenLine size={22} />
                <p className="font-semibold text-[#27312d]">Nothing selected</p>
                <p>Click a lesson to edit it, or use Add on a day.</p>
              </div>
            ) : (
              <form onSubmit={submitEditor} className="editor-form">
                <div className="editor-head">
                  <span className={`kind-icon kind-${editor.kind}`}>{editor.icon}</span>
                  <div className="min-w-0">
                    <h3>{editor.title}</h3>
                    <p>{editor.context}</p>
                  </div>
                  <button type="button" className="icon-button compact ghost" onClick={closeEditor} aria-label="Close editor"><X size={16} /></button>
                </div>

                <div className="editor-body">
                  {editorMode === "course" && (
                    <>
                      <Field label="Name"><input className="field" value={courseForm.name} onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })} /></Field>
                      <Field label="Description"><textarea className="field min-h-24" value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} /></Field>
                      <div className="field-row">
                        <Field label="Author"><input className="field" value={courseForm.authorName} onChange={(e) => setCourseForm({ ...courseForm, authorName: e.target.value })} /></Field>
                        <Field label="Access">
                          <select className="field" value={courseForm.isPaid ? "paid" : "free"} onChange={(e) => setCourseForm({ ...courseForm, isPaid: e.target.value === "paid" })}>
                            <option value="free">Free</option>
                            <option value="paid">Paid</option>
                          </select>
                        </Field>
                      </div>
                      <Field label="Thumbnail" hint={thumbnailFile ? `Will upload as WebP: ${thumbnailFile.name}` : "Images are compressed before upload."}>
                        <input type="file" accept="image/*" className="file-field" onChange={(event) => setThumbnailFile(event.target.files?.[0] || null)} />
                      </Field>
                      <Advanced>
                        <Field label="Course order"><input type="number" step="1" className="field" value={courseForm.order} onChange={(e) => setCourseForm({ ...courseForm, order: Number(e.target.value) })} /></Field>
                        <Field label="Thumbnail URL"><input className="field" value={courseForm.thumbnailUrl} onChange={(e) => setCourseForm({ ...courseForm, thumbnailUrl: e.target.value })} /></Field>
                      </Advanced>
                    </>
                  )}

                  {editorMode === "day" && (
                    <>
                      <Field label="Title"><input className="field" value={dayForm.title} onChange={(e) => setDayForm({ ...dayForm, title: e.target.value })} /></Field>
                      <Advanced>
                        <Field label="Day number"><input type="number" className="field" value={dayForm.dayNumber} onChange={(e) => setDayForm({ ...dayForm, dayNumber: Number(e.target.value) })} /></Field>
                        <Field label="Day ID" hint={dayIsNew ? undefined : "A day's ID can't be changed."}>
                          <input className="field" value={dayForm.dayId} disabled={!dayIsNew} onChange={(e) => setDayForm({ ...dayForm, dayId: e.target.value })} />
                        </Field>
                      </Advanced>
                    </>
                  )}

                  {editorMode === "video" && (
                    <>
                      <DayField days={allDays} value={itemForm.dayId} onChange={(dayId) => setItemForm({ ...itemForm, dayId })} />
                      <Field label="Title"><input className="field" value={itemForm.title} onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })} /></Field>
                      {itemForm.videoId ? (
                        <p className="note">This lesson has a video. To replace it, clear the Video ID under Advanced and choose a new file.</p>
                      ) : (
                        <Field label="Video file" hint={videoFile ? `Uploads when you save: ${videoFile.name}` : "Uploads to Bunny when you save."}>
                          <input type="file" accept="video/*" className="file-field" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
                        </Field>
                      )}
                      <Field label="Lesson notes" hint="Shown under the video in the app."><textarea className="field min-h-24" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} /></Field>
                      <Toggle checked={itemForm.requiredForCompletion} onChange={(checked) => setItemForm({ ...itemForm, requiredForCompletion: checked })} />
                      <Advanced>
                        <Field label="Order"><input type="number" className="field" value={itemForm.order} onChange={(e) => setItemForm({ ...itemForm, order: Number(e.target.value) })} /></Field>
                        <Field label="Item ID"><input className="field" value={itemForm.itemId} onChange={(e) => setItemForm({ ...itemForm, itemId: e.target.value })} placeholder="Made for you if empty" /></Field>
                        <Field label="Video ID"><input className="field" value={itemForm.videoId} onChange={(e) => setItemForm({ ...itemForm, videoId: e.target.value })} placeholder="Filled after upload" /></Field>
                        <Field label="Duration" hint="Read from Bunny."><input className="field" value={secondsToLabel(itemForm.durationSeconds)} disabled readOnly /></Field>
                      </Advanced>
                    </>
                  )}

                  {editorMode === "text" && (
                    <>
                      <DayField days={course?.days || []} value={promptForm.dayId} onChange={(dayId) => setPromptForm({ ...promptForm, dayId })} />
                      <Field label="Title"><input className="field" value={promptForm.title} onChange={(e) => setPromptForm({ ...promptForm, title: e.target.value })} /></Field>
                      <MarkdownField label="Prompt text" value={promptForm.textContent} onChange={(textContent) => setPromptForm({ ...promptForm, textContent })} placeholder={"Prompt: What made you smile today?"} />
                      <Advanced>
                        <Field label="Order"><input type="number" className="field" value={promptForm.order} onChange={(e) => setPromptForm({ ...promptForm, order: Number(e.target.value) })} /></Field>
                      </Advanced>
                    </>
                  )}

                  {editorMode === "instruction" && (
                    <>
                      <DayField days={course?.days || []} value={instructionForm.dayId} onChange={(dayId) => setInstructionForm({ ...instructionForm, dayId })} />
                      <Field label="Title"><input className="field" value={instructionForm.title} onChange={(e) => setInstructionForm({ ...instructionForm, title: e.target.value })} placeholder="Print your kit" /></Field>
                      <MarkdownField label="Text" value={instructionForm.description} onChange={(description) => setInstructionForm({ ...instructionForm, description })} placeholder={"Download the kit below, print it and cut out the pieces you love."} />
                      <Toggle checked={instructionForm.requiredForCompletion} onChange={(checked) => setInstructionForm({ ...instructionForm, requiredForCompletion: checked })} />
                      <Advanced>
                        <Field label="Order"><input type="number" className="field" value={instructionForm.order} onChange={(e) => setInstructionForm({ ...instructionForm, order: Number(e.target.value) })} /></Field>
                        <Field label="Item ID"><input className="field" value={instructionForm.itemId} onChange={(e) => setInstructionForm({ ...instructionForm, itemId: e.target.value })} placeholder="Made for you if empty" /></Field>
                      </Advanced>
                    </>
                  )}

                  {editorMode === "downloadable" && (
                    <>
                      <Field label="Unlocks after">
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
                      </Field>
                      <Field label="Title"><input className="field" value={downloadableForm.title} onChange={(e) => setDownloadableForm({ ...downloadableForm, title: e.target.value })} /></Field>
                      <Field label="Type">
                        <select className="field" value={downloadableForm.type} onChange={(e) => setDownloadableForm({ ...downloadableForm, type: e.target.value })}>
                          <option value="file">File</option>
                          <option value="image">Image</option>
                          <option value="pdf">PDF</option>
                          <option value="zip">ZIP</option>
                          <option value="spotify">Spotify playlist</option>
                          <option value="external_link">Link</option>
                          <option value="playlist">Gallery (several files)</option>
                        </select>
                      </Field>
                      {isLinkReward ? (
                        <Field label={downloadableForm.type === "spotify" ? "Spotify link" : "Link"}>
                          <input className="field" value={downloadableForm.url} onChange={(e) => setDownloadableForm({ ...downloadableForm, url: e.target.value })} placeholder="https://" />
                        </Field>
                      ) : (
                        <Field label="Files" hint="Choose several images to make a gallery.">
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
                        </Field>
                      )}
                      {downloadableFiles.length > 0 && (
                        <div className="sub-list">
                          <div className="sub-list-title">{downloadableFiles.length > 1 ? `${downloadableFiles.length} files to upload` : "File to upload"}</div>
                          {downloadableFiles.map((file, index) => (
                            <div key={`${file.name}-${file.lastModified}`} className="sub-list-row">
                              <span className="truncate">{index + 1}. {file.name}</span>
                              <span className="shrink-0 uppercase">{downloadableTypeForFile(file)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {downloadableForm.assetId && (findCourseDownloadable(course, downloadableForm.assetId)?.items?.length || 0) > 0 && (
                        <div className="sub-list">
                          <div className="sub-list-title">Order in the gallery (drag to change)</div>
                          {[...(findCourseDownloadable(course, downloadableForm.assetId)?.items || [])]
                            .sort((a, b) => a.order - b.order)
                            .map((item) => (
                              <div
                                key={item.assetId}
                                className="playlist-order-row"
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  const dragged = readDragData(event);
                                  if (dragged?.kind === "playlist-item" && dragged.parentId === downloadableForm.assetId) {
                                    event.preventDefault();
                                    void reorderDownloadableItems(downloadableForm.assetId, dragged.id, item.assetId);
                                  }
                                }}
                              >
                                <span draggable onDragStart={(event) => setDragData(event, "playlist-item", item.assetId, downloadableForm.assetId)} onDragEnd={clearDragStyle} className="drag-handle" title="Drag to reorder"><GripVertical size={14} /></span>
                                <span className="truncate">{item.order}. {item.title}</span>
                              </div>
                            ))}
                        </div>
                      )}
                      <Advanced>
                        <Field label="Order"><input type="number" min="1" className="field" value={downloadableForm.order} onChange={(e) => setDownloadableForm({ ...downloadableForm, order: Number(e.target.value) })} /></Field>
                        {!isLinkReward && (
                          <Field label="File URL"><input className="field" value={downloadableForm.url} onChange={(e) => setDownloadableForm({ ...downloadableForm, url: e.target.value })} placeholder="Filled after upload" /></Field>
                        )}
                      </Advanced>
                    </>
                  )}
                </div>

                <div className="editor-footer">
                  <button className="primary-button" disabled={editor.disabled}>
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {editor.save}
                  </button>
                  <button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button>
                  {editorMode === "text" && promptDayHasPrompt && (
                    <button type="button" className="link-button" disabled={busy} onClick={promptToInstruction}>Make it an instruction</button>
                  )}
                </div>
              </form>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

/** "Day 3 · Purposeful Visualization", or just "Day 3" when the day has no title of its own. */
function dayLabel(day: CourseDay) {
  if (day.dayNumber <= 0) return day.title || "Introduction";
  const plain = `Day ${day.dayNumber}`;
  const title = day.title?.trim() || "";
  return title && title.toLowerCase() !== plain.toLowerCase() ? `${plain} · ${title}` : plain;
}

const ITEM_KINDS: Record<string, { label: string; kind: string; icon: (size: number) => ReactNode }> = {
  video: { label: "Video", kind: "video", icon: (size) => <Video size={size} /> },
  prompt: { label: "Prompt", kind: "prompt", icon: (size) => <PenLine size={size} /> },
  instruction: { label: "Instruction", kind: "instruction", icon: (size) => <BookOpen size={size} /> },
};

function itemKind(item: CourseDayItem) {
  return ITEM_KINDS[item.type] || { label: item.type || "Lesson", kind: "other", icon: (size: number) => <BookOpen size={size} /> };
}

function rewardTypeLabel(downloadable: CourseDownloadable) {
  if (downloadable.type === "playlist" || downloadable.items?.length) {
    const count = downloadable.items?.length || 0;
    return `Gallery · ${count} ${count === 1 ? "file" : "files"}`;
  }
  const labels: Record<string, string> = { image: "Image", pdf: "PDF", zip: "ZIP", file: "File", spotify: "Spotify", external_link: "Link" };
  return labels[downloadable.type] || downloadable.type || "File";
}

function daySummary(day: CourseDay, rewards: number) {
  const counts = new Map<string, number>();
  day.items.forEach((item) => {
    const label = itemKind(item).label.toLowerCase();
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const parts = [...counts.entries()].map(([label, count]) => `${count} ${label}${count === 1 ? "" : "s"}`);
  if (rewards) parts.push(`${rewards} ${rewards === 1 ? "reward" : "rewards"}`);
  return parts.join(" · ") || "Empty";
}

function SyncStatus({ busy, message, syncing, lastError, savedAt }: {
  busy: boolean;
  message: string;
  syncing: boolean;
  lastError: string | null;
  savedAt: number | null;
}) {
  if (busy) return <span className="sync sync-busy"><Loader2 size={14} className="animate-spin" /><span>{message}…</span></span>;
  if (lastError) return <span className="sync sync-error" title={lastError}><CircleAlert size={14} /><span>Something went wrong</span></span>;
  if (syncing) return <span className="sync sync-busy"><Loader2 size={14} className="animate-spin" /><span>Syncing</span></span>;
  if (savedAt) return <span className="sync sync-ok"><CheckCircle2 size={14} /><span>All changes saved</span></span>;
  return null;
}

function Menu({ id, label, icon, iconOnly = false, openMenu, setOpenMenu, children }: {
  id: string;
  label: string;
  icon: ReactNode;
  iconOnly?: boolean;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  children: ReactNode;
}) {
  const open = openMenu === id;
  return (
    <span className="menu" data-menu>
      <button
        type="button"
        className={iconOnly ? "icon-button compact" : "small-button"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={iconOnly ? label : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpenMenu(open ? null : id);
        }}
      >
        {icon}
        {!iconOnly && <span>{label}</span>}
      </button>
      {open && (
        <span className="menu-list" role="menu" onClick={() => setOpenMenu(null)}>
          {children}
        </span>
      )}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="label">
      {label}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

function Advanced({ children }: { children: ReactNode }) {
  return (
    <details className="advanced">
      <summary>Advanced</summary>
      <div className="advanced-body">{children}</div>
    </details>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>Needed to finish the day</span>
    </label>
  );
}

function DayField({ days, value, onChange }: { days: CourseDay[]; value: string; onChange: (dayId: string) => void }) {
  const known = days.some((day) => day.dayId === value);
  return (
    <Field label="Day">
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value={value}>{value}</option>}
        {days.map((day) => <option key={day.dayId} value={day.dayId}>{dayLabel(day)}</option>)}
      </select>
    </Field>
  );
}

function MarkdownField({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="label">
      <span className="field-label-row">
        {label}
        <span className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={!preview} className={!preview ? "is-on" : ""} onClick={() => setPreview(false)}>Write</button>
          <button type="button" role="tab" aria-selected={preview} className={preview ? "is-on" : ""} onClick={() => setPreview(true)}>Preview</button>
        </span>
      </span>
      {preview ? (
        <div className="md-preview">{value.trim() ? renderMarkdown(value) : <p className="hint">Nothing to preview yet.</p>}</div>
      ) : (
        <textarea className="field field-tall" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
      <span className="hint">## Heading · ###### Small note · **bold** · *italic* · [link](https://…)</span>
    </div>
  );
}

/** A preview close to how the app shows course text: blocks split by blank lines. */
function renderMarkdown(text: string) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block, index) => {
      const trimmed = block.trim();
      if (trimmed.startsWith("######")) return <p key={index} className="md-note">{renderInline(trimmed.replace(/^#+\s*/, "").toUpperCase())}</p>;
      if (trimmed.startsWith("#")) return <h4 key={index} className="md-heading">{renderInline(trimmed.replace(/^#+\s*/, ""))}</h4>;
      return <p key={index}>{renderInline(trimmed)}</p>;
    });
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|\n)/g);
  return parts.map((part, index) => {
    if (part === "\n") return <br key={index} />;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (/^\*\*\*[^*]+\*\*\*$/.test(part)) return <strong key={index}><em>{part.slice(3, -3)}</em></strong>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

type DayCardProps = {
  day: CourseDay;
  rewards: CourseDownloadable[];
  intro?: boolean;
  defaultOpen?: boolean;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  activeKey: string;
  onEditDay: (day: CourseDay) => void;
  onDeleteDay: (dayId: string) => void;
  onAddVideo: (day: CourseDay) => void;
  onAddPrompt: (day: CourseDay) => void;
  onAddInstruction: (day: CourseDay) => void;
  onAddReward: (day: CourseDay) => void;
  onEditItem: (day: CourseDay, item: CourseDayItem) => void;
  onDeleteItem: (dayId: string, itemId: string) => void;
  onEditReward: (downloadable: CourseDownloadable) => void;
  onDeleteReward: (assetId: string) => void;
  onReorderDay?: (sourceId: string, targetId: string) => Promise<void>;
  onReorderItem: (dayId: string, sourceId: string, targetId: string) => Promise<void>;
  onReorderReward?: (dayId: string, sourceId: string, targetId: string) => Promise<void>;
};

function DayCard({ day, rewards, intro = false, defaultOpen = false, openMenu, setOpenMenu, activeKey, onEditDay, onDeleteDay, onAddVideo, onAddPrompt, onAddInstruction, onAddReward, onEditItem, onDeleteItem, onEditReward, onDeleteReward, onReorderDay, onReorderItem, onReorderReward }: DayCardProps) {
  const prompt = day.items.find((item) => item.type === "prompt");
  const title = day.title?.trim() || (intro ? "Introduction" : `Day ${day.dayNumber}`);
  const showNumber = !intro && title.toLowerCase() !== `day ${day.dayNumber}`;
  return (
    <details
      className={`tree-node day-card ${activeKey === `day:${day.dayId}` ? "is-active" : ""}`}
      open={defaultOpen}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const dragged = readDragData(event);
        if (dragged?.kind === "day" && onReorderDay) {
          event.preventDefault();
          void onReorderDay(dragged.id, day.dayId);
        }
      }}
    >
      <summary className="tree-summary">
        {!intro && onReorderDay ? (
          <span draggable onDragStart={(event) => setDragData(event, "day", day.dayId)} onDragEnd={clearDragStyle} className="drag-handle" title="Drag to reorder days"><GripVertical size={15} /></span>
        ) : <span />}
        <span className="tree-chevron"><ChevronDown size={16} /></span>
        <span className="day-title-wrap">
          {showNumber && <span className="day-number">Day {day.dayNumber}</span>}
          <span className="day-title">{title}</span>
          <span className="day-meta">{daySummary(day, rewards.length)}</span>
        </span>
        <span className="day-actions" onClick={(event) => event.preventDefault()}>
          {intro ? (
            <button type="button" className="small-button" onClick={() => onAddVideo(day)}><Plus size={14} /> Video</button>
          ) : (
            <Menu id={`add-${day.dayId}`} label="Add" icon={<Plus size={14} />} openMenu={openMenu} setOpenMenu={setOpenMenu}>
              <button type="button" role="menuitem" className="menu-item" onClick={() => onAddVideo(day)}><span className="kind-icon kind-video"><Video size={14} /></span> Video</button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => (prompt ? onEditItem(day, prompt) : onAddPrompt(day))}><span className="kind-icon kind-prompt"><PenLine size={14} /></span> {prompt ? "Edit prompt" : "Prompt"}</button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => onAddInstruction(day)}><span className="kind-icon kind-instruction"><BookOpen size={14} /></span> Instruction</button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => onAddReward(day)}><span className="kind-icon kind-reward"><Gift size={14} /></span> Reward</button>
            </Menu>
          )}
          <Menu id={`day-${day.dayId}`} label="Day options" iconOnly icon={<Ellipsis size={16} />} openMenu={openMenu} setOpenMenu={setOpenMenu}>
            <button type="button" role="menuitem" className="menu-item" onClick={() => onEditDay(day)}><Pencil size={15} /> Edit day</button>
            {(!intro || day.items.length > 0) && (
              <button type="button" role="menuitem" className="menu-item menu-item-danger" onClick={() => onDeleteDay(day.dayId)}><Trash2 size={15} /> Delete day</button>
            )}
          </Menu>
        </span>
      </summary>
      <div className="tree-items">
        {day.items.length === 0 && rewards.length === 0 && (
          <p className="day-empty">{intro ? "No intro video yet." : "Nothing here yet. Use Add for a video, prompt, instruction or reward."}</p>
        )}
        {sortItems(day.items).map((item) => {
          const kind = itemKind(item);
          const active = activeKey === `${day.dayId}:${item.itemId}` || (item.type === "prompt" && activeKey === `${day.dayId}:prompt`);
          return (
            <div
              key={item.itemId}
              className={`tree-item ${active ? "is-active" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const dragged = readDragData(event);
                if (dragged?.kind === "item" && dragged.parentId === day.dayId) {
                  event.preventDefault();
                  void onReorderItem(day.dayId, dragged.id, item.itemId);
                }
              }}
            >
              <span draggable onDragStart={(event) => setDragData(event, "item", item.itemId, day.dayId)} onDragEnd={clearDragStyle} className="drag-handle" title="Drag to reorder"><GripVertical size={14} /></span>
              <span className={`kind-icon kind-${kind.kind}`}>{kind.icon(15)}</span>
              <button type="button" className="row-main" onClick={() => onEditItem(day, item)}>
                <span className="row-title">{item.title || "Untitled"}</span>
                <span className="row-meta">
                  <span className={`kind-chip kind-${kind.kind}`}>{kind.label}</span>
                  {item.type === "video" && (item.durationSeconds || 0) > 0 && <span>{secondsToLabel(item.durationSeconds)}</span>}
                  {!item.requiredForCompletion && <span>Optional</span>}
                </span>
              </button>
              <button type="button" className="icon-button compact ghost row-delete" onClick={() => onDeleteItem(day.dayId, item.itemId)} title="Delete" aria-label={`Delete ${item.title}`}><Trash2 size={14} /></button>
            </div>
          );
        })}
        {rewards.map((downloadable) => (
          <RewardRow
            key={downloadable.assetId}
            downloadable={downloadable}
            active={activeKey === `reward:${downloadable.assetId}`}
            onEdit={onEditReward}
            onDelete={onDeleteReward}
            onDrop={onReorderReward ? (sourceId) => void onReorderReward(day.dayId, sourceId, downloadable.assetId) : undefined}
            dayId={day.dayId}
          />
        ))}
      </div>
    </details>
  );
}

function RewardRow({ downloadable, active, onEdit, onDelete, onDrop, dayId = "" }: {
  downloadable: CourseDownloadable;
  active: boolean;
  onEdit: (downloadable: CourseDownloadable) => void;
  onDelete: (assetId: string) => void;
  onDrop?: (sourceId: string) => void;
  dayId?: string;
}) {
  return (
    <div
      className={`tree-item ${active ? "is-active" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const dragged = readDragData(event);
        if (onDrop && dragged?.kind === "reward" && dragged.parentId === dayId) {
          event.preventDefault();
          onDrop(dragged.id);
        }
      }}
    >
      {onDrop ? (
        <span draggable onDragStart={(event) => setDragData(event, "reward", downloadable.assetId, dayId)} onDragEnd={clearDragStyle} className="drag-handle" title="Drag to reorder"><GripVertical size={14} /></span>
      ) : <span />}
      <span className="kind-icon kind-reward"><Gift size={15} /></span>
      <button type="button" className="row-main" onClick={() => onEdit(downloadable)}>
        <span className="row-title">{downloadable.title || "Untitled reward"}</span>
        <span className="row-meta">
          <span className="kind-chip kind-reward">Reward</span>
          <span>{rewardTypeLabel(downloadable)}</span>
        </span>
      </button>
      <button type="button" className="icon-button compact ghost row-delete" onClick={() => onDelete(downloadable.assetId)} title="Delete" aria-label={`Delete ${downloadable.title}`}><Trash2 size={14} /></button>
    </div>
  );
}
