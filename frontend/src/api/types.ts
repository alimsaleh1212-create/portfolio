/** Response shapes of the content endpoints, mirroring `backend/app/content/schema.py`. */

export interface Links {
  email: string;
  linkedin: string;
  github: string;
}

export interface SkillCategory {
  category: string;
  items: string[];
}

export interface Experience {
  role: string;
  organization: string;
  location: string | null;
  period: string;
  highlights: string[];
}

export interface Education {
  title: string;
  institution: string;
  location: string;
  year: string;
}

export interface Certification {
  title: string;
  issuer: string;
}

export interface Profile {
  name: string;
  headline: string;
  location: string;
  summary: string;
  links: Links;
  skills: SkillCategory[];
  experience: Experience[];
  education: Education[];
  certifications: Certification[];
}

/** One figure from the CV: the number, and what it measures. */
export interface Metric {
  value: string;
  label: string;
}

/** One picture on a Project page: alt text and variants shaped like the Portrait's. */
export interface ProjectMedia {
  alt: string | null;
  variants: MediaVariant[];
}

export interface Project {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  stack: string[];
  metrics: Metric[];
  /** The API sends no Project media yet; the page draws a gallery only when this has pictures. */
  media?: ProjectMedia[];
}

export type MediaRole = "portrait" | "video_cv" | "cv_pdf";

/** One file of a media item; `url` is on our own origin under `/media/`. */
export interface MediaVariant {
  kind: "image" | "video" | "poster" | "document";
  /** avif, webp, jpeg, h264 or pdf. */
  format: string;
  content_type: string;
  url: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
}

/** The Portrait, the Video CV or the CV PDF. A role that was not seeded is absent. */
export interface MediaItem {
  role: MediaRole;
  alt: string | null;
  download_name: string | null;
  duration_seconds: number | null;
  variants: MediaVariant[];
}

export type StageKey =
  "trailhead" | "long-approach" | "steep-switch" | "ridge" | "high-camp";

/** One Stage of the Climb. A placeholder Challenge has not been written by Ali yet. */
export interface Stage {
  key: StageKey;
  name: string;
  /** The Ridge has none. */
  period: string | null;
  body: string;
  challenge: string;
  challenge_is_placeholder: boolean;
}
