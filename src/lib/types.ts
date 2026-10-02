export type CourseDayItem = {
  itemId: string;
  type: "video" | "prompt" | string;
  order: number;
  title: string;
  description?: string;
  durationSeconds?: number;
  requiredForCompletion: boolean;
  videoId?: string;
};

export type CourseDay = {
  dayId: string;
  courseId: string;
  dayNumber: number;
  title: string;
  description: string;
  thumbnailUrl?: string;
  textContent?: string;
  contentFormat?: string;
  items: CourseDayItem[];
  videoId?: string;
};

export type CourseDownloadableItem = {
  assetId: string;
  title: string;
  type: "image" | "pdf" | "zip" | "spotify" | "external_link" | "file" | string;
  url: string;
  order: number;
};

export type CourseDownloadable = {
  assetId: string;
  title: string;
  type: "image" | "pdf" | "zip" | "playlist" | "spotify" | "external_link" | "file" | string;
  url?: string;
  unlockAfter: string;
  order: number;
  items?: CourseDownloadableItem[];
};

export type Course = {
  order?: number;
  courseId: string;
  name: string;
  description: string;
  authorId: string;
  authorName?: string;
  isPaid: boolean;
  disabled?: boolean;
  thumbnailUrl?: string;
  introVideos?: CourseDay[];
  days: CourseDay[];
  downloadables?: CourseDownloadable[];
  timestamps: string;
};

export type CourseSummary = {
  order?: number;
  courseId: string;
  name: string;
  description: string;
  authorId: string;
  authorName?: string;
  isPaid: boolean;
  disabled?: boolean;
  thumbnailUrl?: string;
  dayCount: number;
  timestamps: string;
};

export type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown } | string;
};
