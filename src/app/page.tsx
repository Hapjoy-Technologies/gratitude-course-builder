"use client";

import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  GripVertical,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
  Video,
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

type EditorMode = "course" | "day" | "video" | "text" | "downloadable";

export default function Home() {
  return <CoursesAdmin />;
}

function CoursesAdmin() {
  const token = "";
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
  const [downloadableForm, setDownloadableForm] = useState(emptyDownloadableForm);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [downloadableFiles, setDownloadableFiles] = useState<File[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>("course");
  const [isCreatingCourse, setIsCreatingCourse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [message, setMessage] = useState("Ready");
  const [orderToast, setOrderToast] = useState<{ id: number; text: string } | null>(null);

  const selectedDay = useMemo(() => {
    if (!course) return null;
    return findCourseDay(course, itemForm.dayId) || courseDays(course)[0] || null;
  }, [course, itemForm.dayId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (saved === "true") {
        setIsUnlocked(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!orderToast) return;
    const timeout = window.setTimeout(() => setOrderToast(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [orderToast]);

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
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Failed to load courses");
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isUnlocked]);

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
    try {
      await action();
      setMessage(`${label} done`);
      if (successToast) setOrderToast({ id: Date.now(), text: successToast });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something failed");
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

  function addIntroVideo() {
    if (!course) return;
    const introDay = course.introVideos?.[0] || defaultIntroDay(course);
    addVideoToDay(introDay);
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
        await loadCourses();
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
        await loadCourse(course.courseId);
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
        await loadCourse(course.courseId);
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
        await loadCourse(course.courseId);
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
        await loadCourse(course.courseId);
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

  async function toggleCourseDisabled() {
    if (!course) return;
    const nextDisabled = !course.disabled;
    await run(nextDisabled ? "Disabling course" : "Enabling course", async () => {
      await apiRequest(`/v1/courses/${course.courseId}`, token, {
        method: "PUT",
        body: JSON.stringify({ disabled: nextDisabled }),
      });
      await loadCourse(course.courseId);
      await loadCourses();
    });
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
      <header className="app-header sticky top-0 z-20">
        <div className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="brand-mark"><BookOpen size={19} /></div>
            <div>
              <h1 className="text-lg font-semibold">Course Operations</h1>
              <p className="text-xs text-[#6b7280]">Internal course operations</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isUnlocked && (
              <>
                <button onClick={() => run("Loading courses", loadCourses)} className="icon-button" title="Refresh courses"><RefreshCw size={17} /></button>
                <button onClick={handleLock} className="secondary-button" title="Lock course operations"><Lock size={15} /> Lock</button>
              </>
            )}
            <span className="environment-badge">Dev</span>
          </div>
        </div>
      </header>

      {orderToast && (
        <div key={orderToast.id} className="order-toast" role="status" aria-live="polite">
          <CheckCircle2 size={16} />
          {orderToast.text}
        </div>
      )}

      {!isUnlocked ? (
        <div className="flex min-h-[calc(100vh-64px)] items-center justify-center p-6 bg-[#f5f7f5]">
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
        <div className="course-workspace">
          <aside className="course-sidebar" aria-label="Courses">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Courses</h2>
              <div className="flex items-center gap-2">
                <button type="button" onClick={startNewCourse} className="small-button"><Plus size={15} /> New course</button>
                <button onClick={syncBunny} className="icon-button" title="Sync Bunny collections"><RefreshCw size={16} /></button>
              </div>
            </div>
            <div className="space-y-2">
              {courses.map((item) => (
                <button
                  key={item.courseId}
                  draggable={!busy}
                  onDragStart={(event) => setDragData(event, "course", item.courseId)}
                  onDragEnd={clearDragStyle}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dragged = readDragData(event);
                    if (dragged?.kind === "course") void reorderCourses(dragged.id, item.courseId);
                  }}
                  onClick={() => run("Loading course", () => loadCourse(item.courseId))}
                  className={`list-row text-left ${selectedCourseId === item.courseId ? "list-row-active" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5"><GripVertical size={14} className="shrink-0 text-[#9aa1ad]" /><span className="font-medium">{item.name}</span></span>
                    <span className={`status-pill ${item.disabled ? "status-pill-disabled" : "status-pill-enabled"}`}>
                      {item.disabled ? "Disabled" : "Enabled"}
                    </span>
                  </span>
                  <span className="text-xs text-[#6b7280]">{item.dayCount} days</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="course-content">
            <div className="course-heading mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">{course?.name || "New course"}</h2>
                <p className="text-sm text-[#6b7280]">{message}{busy ? "..." : ""}</p>
              </div>
              {(busy || initialLoading) && <Loader2 className="animate-spin text-[#e94b76]" />}
            </div>

            {course && <div className="course-metadata-bar">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button className="inline-flex items-center gap-2 text-left" onClick={editCourse}>
                  <BookOpen size={18} className="text-[#e94b76]" />
                  <span>
                    <span className="block text-sm font-semibold">Course metadata</span>
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="secondary-button" onClick={addIntroVideo}><Video size={15} /> Intro video</button>
                  <button className="secondary-button" onClick={editCourse}><Pencil size={15} /> Edit</button>
                  <button className="secondary-button" onClick={promoteCourse} disabled={busy || !PROD_API_BASE} title={!PROD_API_BASE ? "Configure NEXT_PUBLIC_COURSES_PROD_API_BASE_URL" : "Copy this course and its assets to production"}>
                    <Upload size={15} /> Promote
                  </button>
                  <button className={course.disabled ? "primary-button" : "secondary-button"} onClick={toggleCourseDisabled} disabled={busy}>
                    <Power size={15} /> {course.disabled ? "Enable" : "Disable"}
                  </button>
                </div>
              </div>
            </div>}

            {initialLoading && !course && (
              <div className="panel grid min-h-40 place-items-center text-sm font-semibold text-[#6b7280]">
                Loading course data...
              </div>
            )}

            {!initialLoading && !course && !isCreatingCourse && (
              <div className="panel grid min-h-40 place-items-center text-center">
                <div>
                  <p className="text-sm font-semibold">No course selected</p>
                  <p className="mt-1 text-xs text-[#6b7280]">Refresh courses or choose one from the list.</p>
                </div>
              </div>
            )}

            {isCreatingCourse && (
              <div className="panel grid min-h-40 place-items-center text-center">
                <div>
                  <BookOpen className="mx-auto mb-3 text-[#e94b76]" size={24} />
                  <p className="text-sm font-semibold">Create a new course</p>
                  <p className="mt-1 max-w-sm text-xs text-[#6b7280]">Complete the course metadata in the editor. Saving creates its Bunny collection and DynamoDB record.</p>
                </div>
              </div>
            )}

            {course && (
              <div className="course-sections">
                <CourseSection
                  days={introVideoDays(course)}
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
                  onReorderItem={reorderItems}
                  introOnly
                />
                <CourseSection
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
                  onAddDay={addDay}
                  onReorderDay={reorderDays}
                  onReorderItem={reorderItems}
                  onReorderDownloadable={reorderDownloadables}
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

          <aside className="course-editor" aria-label="Course editor">
            <div className="editor-heading">
              <h3 className="text-base font-semibold">Editor</h3>
              <span className="editor-context">{isCreatingCourse ? "New course" : course?.name || "No course selected"}</span>
            </div>

            <label className="label mb-4">
              Operation
              <select className="field" value={editorMode} disabled={!course} onChange={(e) => setEditorMode(e.target.value as EditorMode)}>
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
                  <label className="label">Author name<input className="field" value={courseForm.authorName} onChange={(e) => setCourseForm({ ...courseForm, authorName: e.target.value })} /></label>
                  <label className="label">Course order<input type="number" step="1" className="field" value={courseForm.order} onChange={(e) => setCourseForm({ ...courseForm, order: Number(e.target.value) })} /></label>
                  <label className="label">Thumbnail URL<input className="field" value={courseForm.thumbnailUrl} onChange={(e) => setCourseForm({ ...courseForm, thumbnailUrl: e.target.value })} /></label>
                  <label className="label col-span-2">
                    Upload thumbnail
                    <input
                      type="file"
                      accept="image/*"
                      className="file-field"
                      onChange={(event) => setThumbnailFile(event.target.files?.[0] || null)}
                    />
                    {thumbnailFile && <span className="mt-1 text-xs text-slate-500">Will upload compressed WebP: {thumbnailFile.name}</span>}
                  </label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={courseForm.isPaid} onChange={(e) => setCourseForm({ ...courseForm, isPaid: e.target.checked })} /> Paid course</label>
                </div>
                <div className="mt-4 flex gap-2">
                  <button className="primary-button" disabled={busy || !courseForm.name.trim()}><Save size={16} /> {course ? "Save course" : "Create course"}</button>
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
                      <option value="spotify">Spotify Playlist</option>
                      <option value="external_link">External Link</option>
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
                  {downloadableForm.assetId && (findCourseDownloadable(course, downloadableForm.assetId)?.items?.length || 0) > 0 && (
                    <div className="col-span-2 rounded border border-[#e1e5ee] bg-[#f8fafc] p-3">
                      <div className="mb-2 text-xs font-semibold text-[#4b5563]">Playlist order</div>
                      <div className="space-y-1">
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
                              <span draggable onDragStart={(event) => setDragData(event, "playlist-item", item.assetId, downloadableForm.assetId)} onDragEnd={clearDragStyle} className="drag-handle" title="Drag playlist file"><GripVertical size={14} /></span>
                              <span className="truncate text-xs text-[#4b5563]">{item.order}. {item.title}</span>
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
      )}
    </main>
  );
}

function CourseSection({ days, downloadables, onEditDay, onAddVideo, onAddText, onAddDownloadable, onEditItem, onEditDownloadable, onDeleteItem, onDeleteDownloadable, onDeleteDay, onAddDay, onReorderDay, onReorderItem, onReorderDownloadable, introOnly = false }: {
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
  onAddDay?: () => void;
  onReorderDay?: (sourceId: string, targetId: string) => Promise<void>;
  onReorderItem: (dayId: string, sourceId: string, targetId: string) => Promise<void>;
  onReorderDownloadable?: (dayId: string, sourceId: string, targetId: string) => Promise<void>;
  introOnly?: boolean;
}) {
  return (
    <section className={`course-section course-section-${introOnly ? "introduction" : "days"}`}>
      {onAddDay && (
        <div className="course-section-tools">
          <button type="button" className="small-button" onClick={onAddDay}><Plus size={14} /> New day</button>
          <span>{days.length} {days.length === 1 ? "group" : "groups"}</span>
        </div>
      )}
      <div className="space-y-2">
        {days.map((day) => {
          const dayDownloadables = downloadablesForDay(downloadables, day.dayId);
          return (
          <details
            key={day.dayId}
            className="tree-node"
            open={day.dayNumber <= 2 || day.dayId.startsWith("intro-")}
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
              <span className="tree-leading">
                {!introOnly && <span draggable onDragStart={(event) => setDragData(event, "day", day.dayId)} onDragEnd={clearDragStyle} className="drag-handle" title="Drag day"><GripVertical size={15} /></span>}
                <span className="tree-chevron"><ChevronDown size={16} /></span>
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{day.title || day.dayId}</span>
                <span className="block text-xs text-[#6b7280]">
                  {day.dayId} · {day.items.length} items{dayDownloadables.length ? ` · ${dayDownloadables.length} rewards` : ""}
                </span>
              </span>
              <span className="tree-actions">
                <button type="button" className="small-button" onClick={(event) => { event.preventDefault(); onEditDay(day); }}><Pencil size={14} /> Day</button>
                <button type="button" className="small-button" onClick={(event) => { event.preventDefault(); onAddVideo(day); }}><Video size={14} /> Video</button>
                {!introOnly && <button type="button" className="small-button" onClick={(event) => { event.preventDefault(); onAddText(day); }}><FileText size={14} /> Text</button>}
                {!introOnly && <button type="button" className="small-button" onClick={(event) => { event.preventDefault(); onAddDownloadable(day); }}><Download size={14} /> Reward</button>}
                {(!introOnly || day.items.length > 0) && <button type="button" className="icon-button compact" onClick={(event) => { event.preventDefault(); onDeleteDay(day.dayId); }} title="Delete day"><Trash2 size={14} /></button>}
              </span>
            </summary>
            <div className="tree-items">
              {day.items.length === 0 && (
                <div className="px-5 py-4 text-sm text-[#6b7280]">No intro video yet. Use Video to add the descriptive course video.</div>
              )}
              {sortItems(day.items).map((item) => (
                <div
                  key={item.itemId}
                  className="tree-item"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const dragged = readDragData(event);
                    if (dragged?.kind === "item" && dragged.parentId === day.dayId) {
                      event.preventDefault();
                      void onReorderItem(day.dayId, dragged.id, item.itemId);
                    }
                  }}
                >
                  <span className="tree-item-leading">
                    <span draggable onDragStart={(event) => setDragData(event, "item", item.itemId, day.dayId)} onDragEnd={clearDragStyle} className="drag-handle" title="Drag content"><GripVertical size={14} /></span>
                    {item.type === "prompt" ? <FileText size={18} className="text-[#7b6f78]" /> : <Video size={18} className="text-[#e94b76]" />}
                  </span>
                  <button className="min-w-0 text-left" onClick={() => onEditItem(day, item)}>
                    <div className="text-sm font-medium">{item.order}. {item.title}</div>
                    <div className="text-xs text-[#6b7280]">{item.itemId} · {item.type} · {secondsToLabel(item.durationSeconds)}</div>
                  </button>
                  <button className="icon-button compact" onClick={() => onDeleteItem(day.dayId, item.itemId)} title="Delete item"><Trash2 size={14} /></button>
                </div>
              ))}
              {dayDownloadables.map((downloadable) => (
                <div
                  key={downloadable.assetId}
                  className="tree-item"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const dragged = readDragData(event);
                    if (dragged?.kind === "reward" && dragged.parentId === day.dayId && onReorderDownloadable) {
                      event.preventDefault();
                      void onReorderDownloadable(day.dayId, dragged.id, downloadable.assetId);
                    }
                  }}
                >
                  <span className="tree-item-leading">
                    <span draggable onDragStart={(event) => setDragData(event, "reward", downloadable.assetId, day.dayId)} onDragEnd={clearDragStyle} className="drag-handle" title="Drag reward"><GripVertical size={14} /></span>
                    <Download size={18} className="text-[#e94b76]" />
                  </span>
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
    <section className="course-section course-section-rewards">
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
