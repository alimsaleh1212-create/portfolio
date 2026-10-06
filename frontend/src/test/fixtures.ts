import type {
  MediaItem,
  MediaVariant,
  Profile,
  Project,
  ProjectMedia,
  Stage,
} from "../api/types";

export const profile: Profile = {
  name: "Ali Saleh",
  headline: "AI Development Specialist | AI Automation, Agents & Integrations",
  location: "Beirut, Lebanon",
  summary:
    "I am an AI engineer who builds and ships AI agents, automations and API integrations.",
  links: {
    email: "ali@example.com",
    linkedin: "https://linkedin.com/in/ali-example",
    github: "https://github.com/ali-example",
  },
  skills: [
    { category: "Languages", items: ["Python", "TypeScript / JavaScript"] },
    { category: "Agents & Prompt Engineering", items: ["tool calling", "RAG"] },
  ],
  experience: [
    {
      role: "AI Engineer & Team Lead",
      organization: "Kirelo (mini-soccer AI analytics startup)",
      location: "UAE",
      period: "Jun 2026 – Present",
      highlights: [
        "I lead two engineers.",
        "I created a goal detection model at 95% recall.",
      ],
    },
    {
      role: "Backend Developer",
      organization: "Remote / Freelance",
      location: null,
      period: "2019 – 2025",
      highlights: ["I built secure ASP.NET backends."],
    },
  ],
  education: [
    {
      title: "M.Sc., Management Information Systems",
      institution: "Lebanese University",
      location: "Lebanon",
      year: "2018",
    },
  ],
  certifications: [
    { title: "Agent Skills with Anthropic", issuer: "DeepLearning.AI" },
  ],
};

export const projects: Project[] = [
  {
    slug: "one",
    name: "Agentic Coding Workflow Automation",
    tagline: "Claude Code, Codex, opencode",
    description: "I orchestrated three coding agents.",
    stack: ["Claude Code", "Codex"],
    metrics: [],
  },
  {
    slug: "two",
    name: "Claude Skills Suite",
    tagline: "Reusable AI workflows for a team",
    description: "I built six Claude Skills.",
    stack: ["FastAPI"],
    metrics: [],
  },
  {
    slug: "three",
    name: "Drift Triage Co-Pilot",
    tagline: "Self-healing MLOps platform",
    description: "I developed a supervisor agent.",
    stack: ["LangGraph", "Redis"],
    metrics: [{ value: "above 90%", label: "model accuracy sustained" }],
  },
  {
    slug: "four",
    name: "Argus",
    tagline: "Security automation (capstone)",
    description: "I built a multi-agent pipeline.",
    stack: ["FastAPI"],
    metrics: [
      { value: "over 80%", label: "cut in simulated threat-analysis time" },
    ],
  },
  {
    slug: "five",
    name: "Concierge",
    tagline: "Multi-tenant AI SaaS",
    description: "I built a tenant-aware assistant.",
    stack: ["Postgres"],
    metrics: [
      {
        value: "100%",
        label: "of injection and cross-tenant queries blocked in red-team CI",
      },
    ],
  },
  {
    slug: "six",
    name: "Maintainer's Copilot",
    tagline: "Embeddable support chatbot",
    description: "I built a support chatbot.",
    stack: ["RAG"],
    metrics: [
      {
        value: "92%",
        label: "classification accuracy under evaluation-gated CI",
      },
    ],
  },
];

const image = (
  kind: MediaVariant["kind"],
  format: string,
  stem: string,
  width: number,
  height: number,
): MediaVariant => ({
  kind,
  format,
  content_type: format === "jpeg" ? "image/jpeg" : `image/${format}`,
  url: `/media/${stem}-w${width}-${format}`,
  size_bytes: width * 10,
  width,
  height,
  name: null,
});

const widths = [320, 640, 1280];
const formats = ["avif", "webp", "jpeg"];

export const portraitItem: MediaItem = {
  role: "portrait",
  alt: "Ali Saleh smiling in front of green leaves.",
  download_name: null,
  duration_seconds: null,
  variants: widths.flatMap((width) =>
    formats.map((format) =>
      image("image", format, "portrait", width, Math.round(width * 1.05)),
    ),
  ),
};

export const videoItem: MediaItem = {
  role: "video_cv",
  alt: "Video introduction from Ali Saleh.",
  download_name: null,
  duration_seconds: 84.5,
  variants: [
    {
      kind: "video",
      format: "h264",
      content_type: "video/mp4",
      url: "/media/video-1080",
      size_bytes: 22_800_000,
      width: 1920,
      height: 1080,
      name: null,
    },
    {
      kind: "video",
      format: "h264",
      content_type: "video/mp4",
      url: "/media/video-720",
      size_bytes: 12_500_000,
      width: 1280,
      height: 720,
      name: null,
    },
    ...[960, 1280].flatMap((width) =>
      formats.map((format) =>
        image("poster", format, "poster", width, (width * 9) / 16),
      ),
    ),
  ],
};

export const cvItem: MediaItem = {
  role: "cv_pdf",
  alt: null,
  download_name: "Ali_Saleh_CV.pdf",
  duration_seconds: null,
  variants: [
    {
      kind: "document",
      format: "pdf",
      content_type: "application/pdf",
      url: "/media/cv-abc.pdf",
      size_bytes: 89_000,
      width: null,
      height: null,
      name: null,
    },
  ],
};

export const media: MediaItem[] = [portraitItem, videoItem, cvItem];

/** Two pictures for a Project page, shaped like the Portrait's variants. */
export const projectMedia: ProjectMedia[] = [
  {
    alt: "The operations dashboard showing three open alerts.",
    variants: widths.flatMap((width) =>
      formats.map((format) =>
        image("image", format, "shot-one", width, Math.round(width * 0.6)),
      ),
    ),
  },
  {
    alt: "The approval step with a pending action.",
    variants: widths.flatMap((width) =>
      formats.map((format) =>
        image("image", format, "shot-two", width, Math.round(width * 0.6)),
      ),
    ),
  },
];

const stage = (
  key: Stage["key"],
  name: string,
  period: string | null,
  body: string,
  placeholder = true,
): Stage => ({
  key,
  name,
  period,
  body,
  challenge: placeholder
    ? `Ali will write the ${name} Challenge in his own words.`
    : `The ${name} Challenge, written.`,
  challenge_is_placeholder: placeholder,
});

export const stages: Stage[] = [
  stage("trailhead", "Trailhead", "2016 – 2018", "I earned two degrees."),
  stage("long-approach", "Long Approach", "2019 – 2025", "I built backends."),
  stage("steep-switch", "Steep Switch", "2026", "I did the bootcamp.", false),
  stage(
    "ridge",
    "Ridge",
    null,
    "I built six AI automation and agent projects.",
  ),
  stage(
    "high-camp",
    "High Camp",
    "Jun 2026 – Present",
    "I lead two engineers.",
  ),
];

const POSITIONS = [
  "opening",
  "trailhead",
  "long-approach",
  "steep-switch",
  "ridge",
  "high-camp",
  "summit",
];

/** The 1200x630 link-preview crop the media pipeline makes of each wide still. */
const previews: MediaVariant[] = POSITIONS.map((position) => ({
  kind: "still",
  format: "jpeg",
  content_type: "image/jpeg",
  url: `/media/still-${position}-preview-w1200-abc.jpg`,
  size_bytes: 90_000,
  width: 1200,
  height: 630,
  name: `${position}-preview`,
}));

/** The still tier's pictures: each position in a wide and a narrow composition, and a preview crop. */
export const stillsItem: MediaItem = {
  role: "stills",
  alt: null,
  download_name: null,
  duration_seconds: null,
  variants: [
    ...POSITIONS.flatMap((position) =>
      (
        [
          ["wide", [640, 1024, 1600], 1.6],
          ["narrow", [360, 585], 0.4875],
        ] as const
      ).flatMap(([composition, sizes, ratio]) =>
        sizes.flatMap((width) =>
          formats.map((format) => ({
            ...image(
              "still",
              format,
              `${position}-${composition}`,
              width,
              Math.round(width / ratio),
            ),
            name: `${position}-${composition}`,
          })),
        ),
      ),
    ),
    ...previews,
  ],
};
