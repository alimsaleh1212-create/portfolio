import type { Profile, Project } from "../api/types";

export const profile: Profile = {
  name: "Ali Saleh",
  headline: "AI Development Specialist | AI Automation, Agents & Integrations",
  location: "Beirut, Lebanon",
  summary: "I am an AI engineer who builds and ships AI agents, automations and API integrations.",
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
      highlights: ["I lead two engineers.", "I created a goal detection model at 95% recall."],
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
  certifications: [{ title: "Agent Skills with Anthropic", issuer: "DeepLearning.AI" }],
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
    metrics: [{ value: "over 80%", label: "cut in simulated threat-analysis time" }],
  },
  {
    slug: "five",
    name: "Concierge",
    tagline: "Multi-tenant AI SaaS",
    description: "I built a tenant-aware assistant.",
    stack: ["Postgres"],
    metrics: [
      { value: "100%", label: "of injection and cross-tenant queries blocked in red-team CI" },
    ],
  },
  {
    slug: "six",
    name: "Maintainer's Copilot",
    tagline: "Embeddable support chatbot",
    description: "I built a support chatbot.",
    stack: ["RAG"],
    metrics: [{ value: "92%", label: "classification accuracy under evaluation-gated CI" }],
  },
];
