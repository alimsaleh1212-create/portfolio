# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This directory holds no code yet: no package manifest, build tooling, or tests. There are no build, lint, or test commands to run. The only contents are the source documents in `my_docs/` and the agent docs in `docs/agents/`.

The directory name and those documents indicate a personal portfolio for Ali Saleh (AI Development Specialist: AI automation, agents and integrations). No framework or hosting choice is recorded here, so confirm the stack with the user before scaffolding instead of assuming one.

Once a stack exists, replace this section with the real commands (dev server, build, lint, single-test invocation) and an architecture overview.

## Source content (`my_docs/`)

Portfolio copy must come from these files. Do not invent roles, dates, metrics, or project details.

- `Ali_Saleh_CV_AI_Development_Specialist.pdf` is the primary source: summary, skills by category, experience, six AI automation and agent projects (Agentic Coding Workflow Automation, Claude Skills Suite, Drift Triage Co-Pilot, Argus, Concierge, Maintainer's Copilot), education and certifications. It is a PDF, so read it with the Read tool rather than grep.
- `additional-skill.txt` is the user's note on the Kirelo role: full-stack and DevOps duties, building workers connected to RunPod with watchdogs, RunPod MCP, and hosting on Vercel and Supabase. The current CV's Kirelo entry already covers all of this, so the CV wording wins. The note's one extra fact is a hobby (hiking).

The metrics quoted in the CV (95% detection recall, 97% track purity, 92% classification accuracy, and so on) are the user's own figures. Reproduce them exactly as written.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, each label equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
