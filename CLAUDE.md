# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

The design is settled and the code is not yet written, so there are no build, lint, or test commands to run. The stack is decided: React and FastAPI with Postgres, Redis and MinIO in Docker Compose.

Work is tracked in GitHub Issues. The milestone 1 spec is #1 and its tickets are its sub-issues; #2 and #3 outline the later milestones. Read the spec before proposing structure or tooling.

When the first code lands, replace this section with the real commands (run, test, single test, lint) and an architecture overview.

## Design

- **Vocabulary**: `CONTEXT.md` defines the project's terms (Climb, Stage, Visit, Progress and the rest). Use them exactly in code, copy and issues.
- **Decisions**: `docs/adr/` records the choices a reader would otherwise undo, such as the 3D scene and anonymous Visitors.
- **Frontend work**: load the `design-taste-frontend` and `emil-design-eng` skills before building UI, and audit finished UI with `web-design-guidelines`. Ali asked for these by name.

## Source content (`my_docs/`)

Site copy comes from these files and from Ali's own words. Reproduce roles, dates and metrics exactly as written (95% detection recall, 97% track purity, 92% classification accuracy, and so on).

`my_docs/` is git-ignored because the repo is public and the CV carries Ali's phone number. The files exist only on Ali's machine, and the phone number stays out of tracked files.

- `Ali_Saleh_CV_AI_Development_Specialist.pdf` is the primary source: summary, skills by category, experience, six AI automation and agent projects, education and certifications. Read it with the Read tool, since grep cannot search a PDF.
- `additional-skill.txt` is Ali's note on the Kirelo role. The CV's Kirelo entry already covers it, so the CV wording wins. Its one extra fact is that Ali hikes.
- `Ali_Saleh-avatar.jpg` is the Portrait.
- `Ali_Saleh_CV.MOV` is the Video CV: 84 seconds of 1080p HEVC at 115 MB, in English, without captions by Ali's decision.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, each label equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
