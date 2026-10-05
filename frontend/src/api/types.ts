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

export interface Project {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  stack: string[];
  metrics: Metric[];
}
