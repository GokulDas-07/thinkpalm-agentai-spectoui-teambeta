# SpecToUI — Architecture Write-Up

**Project:** SpecToUI  
**Team:** Team Beta  
**Track:** AI Agentic Systems — Mini Project (Task 1)

---

## 1. Problem Statement

Developers who receive a Product Requirements Document (PRD) from a product manager must manually read the document, decide which React components are needed, plan the hierarchy, and write all boilerplate code. For a medium-sized feature this takes 2–4 hours of non-creative, repetitive work.

SpecToUI solves this by running an AI agentic pipeline that reads the PRD, plans a typed component tree, and streams production-ready TSX code back to a 3-panel UI — in under 60 seconds.

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Next.js)                    │
│                                                             │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  PRD Editor  │  │ Component Preview│  │ Code Export  │  │
│  │  (Monaco)    │  │ Tree View / SSE  │  │ ZIP Download │  │
│  └──────┬───────┘  └────────▲─────────┘  └──────▲───────┘  │
│         │ POST /api/generate │ SSE Events         │         │
└─────────┼────────────────────┼────────────────────┼─────────┘
          │                    │                    │
┌─────────▼────────────────────┼────────────────────┼─────────┐
│                   Next.js API Route                          │
│              /api/generate (ReadableStream)                  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  AgentOrchestrator                   │   │
│  │                                                      │   │
│  │  ┌─────────────────┐     ┌──────────────────────┐   │   │
│  │  │  PlannerAgent   │────▶│   GeneratorAgent     │   │   │
│  │  │                 │     │                      │   │   │
│  │  │ Tools:          │     │ Tools:               │   │   │
│  │  │ • validate_prd  │     │ • validate_tsx       │   │   │
│  │  │ • suggest_layout│     │ • check_accessibility│   │   │
│  │  │ • search_npm    │     │                      │   │   │
│  │  └────────┬────────┘     └──────────┬───────────┘   │   │
│  │           │                         │               │   │
│  │           └──────────┬──────────────┘               │   │
│  │                      │                              │   │
│  │              ┌───────▼────────┐                     │   │
│  │              │  AgentMemory   │                     │   │
│  │              │ Session + File │                     │   │
│  │              └────────────────┘                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
          │
┌─────────▼──────────┐
│   Groq API         │
│   Llama 3.3 70B    │
│   (Free tier)      │
└────────────────────┘
```

---

## 3. Component Breakdown

### 3.1 Frontend — 3-Panel UI (Next.js 14 App Router)

**PRD Editor Panel (left)**
- Monaco Editor for rich PRD text input
- Drag-and-drop file upload for `.md` and `.txt` files
- Sample PRD loader (E-commerce, Dashboard, Onboarding)
- PRD history browser (loads previous sessions from localStorage)
- Real-time progress bar and status message during generation
- Keyboard shortcut: `Ctrl+Enter` / `Cmd+Enter` to trigger generation

**Component Preview Panel (center)**
- Tree View tab: recursive visual hierarchy of planned components
- Each node shows type badge (layout/section/ui/form/data), props, and Tailwind classes
- Clicking a node shows its full spec: description, props table, suggested classes
- Preview tab: opens generated components in StackBlitz live environment

**Code Export Panel (right)**
- File sidebar listing all generated components with green/gray status dots
- Syntax-highlighted TSX code viewer per component (react-syntax-highlighter)
- Per-component copy button with 2-second "Copied!" feedback
- Copy All button for the full component library
- Export ZIP button: downloads all components + index.tsx + tailwind.config.js

### 3.2 API Layer — Streaming Route

`/api/generate` is a Next.js App Router Route Handler that:
- Accepts POST with `{ prdText: string }`
- Validates input length (minimum 50 characters)
- Applies in-memory rate limiting (10 requests/minute per IP)
- Creates a `ReadableStream` that runs the AgentOrchestrator
- Forwards typed `OrchestrationEvent` objects as Server-Sent Events (SSE)
- Clients consume events via `EventSource` / streaming fetch in `useGenerate` hook

### 3.3 Agent Pipeline

**PlannerAgent**
- Receives raw PRD text and session history
- Implements ReAct loop (Thought → Action → Observation → Action) up to 5 iterations
- Calls Groq tool-use API with 3 tools:
  - `validate_prd_quality` — checks PRD has sufficient detail, returns warnings
  - `suggest_layout_pattern` — recommends layout based on detected app type
  - `search_component_library` — hits live NPM registry API for package suggestions
- Produces a validated `ComponentTree` JSON (checked against Zod schema)
- Stores plan in `AgentMemory` under `component_tree` and `prd_analysis`

**GeneratorAgent**
- Receives `ComponentTree` from PlannerAgent via `AgentMemory`
- Flattens recursive tree to iterate every component including nested children
- For each component, implements ReAct loop with 2 tools:
  - `validate_tsx_syntax` — checks generated code has valid structure (export, return, component name)
  - `check_accessibility` — verifies presence of aria attributes and semantic HTML
- If tools identify issues, adds a correction prompt and regenerates
- Yields `{ componentId, componentName, code }` as an async generator (streaming)
- Stores each result in `AgentMemory` under `code_{componentId}`

**SummarizerAgent**
- Runs after GeneratorAgent completes
- Reads `prd_analysis`, `component_tree`, and `library_suggestions` from AgentMemory
- Produces a structured summary: component count by type, accessibility score, developer next steps
- Stores result in `AgentMemory` under `generation_summary`

**AgentOrchestrator**
- Composes all three agents with a shared `AgentMemory` instance
- Emits typed streaming events to the API route:
  - `status` — progress updates with percentage
  - `tree_ready` — full ComponentTree JSON
  - `component_ready` — individual component code as it is generated
  - `summary_ready` — final summary from SummarizerAgent
  - `done` — completion signal with summary stats
  - `error` — error message if any agent fails

### 3.4 Memory System — AgentMemory

**Session memory (in-process Map)**
- Stores all agent outputs during a generation session
- Shared instance passed to PlannerAgent, GeneratorAgent, and SummarizerAgent
- Enables inter-agent communication without direct coupling
- Cleared at the start of each new generation (history preserved)

**Client-side persistent memory (localStorage)**
- Saves PRD history entries after each successful generation
- Entries: `{ prdText (first 200 chars), pageTitle, componentCount, createdAt }`
- Maximum 10 history entries (oldest dropped)
- Survives page refresh — reloaded on app mount
- Accessible via the History button in the PRD Editor panel

**Server-side persistent memory (filesystem JSON)**
- Writes key agent outputs to `.memory-store.json` in project root
- Provides true cross-session server-side persistence
- Merged with in-process Map on AgentMemory construction
- `.memory-store.json` excluded from git via `.gitignore`

---

## 4. Data Flow — Step by Step

```
1. User pastes/uploads PRD text in Monaco Editor
2. User clicks "Generate UI" (or presses Ctrl+Enter)
3. useGenerate hook POSTs { prdText } to /api/generate
4. API route validates input and starts ReadableStream
5. AgentOrchestrator.run(prdText) begins — emits status event (10%)
6. PlannerAgent.run(prdText, sessionHistory):
   a. Calls Groq with validate_prd_quality tool
   b. Receives tool call → executes locally → returns observation
   c. Calls Groq with suggest_layout_pattern tool
   d. Calls live NPM API via search_component_library tool
   e. Sends final prompt to get ComponentTree JSON
   f. Validates with Zod schema
   g. Stores in AgentMemory
7. Orchestrator emits tree_ready event (30%) → UI renders Tree View
8. GeneratorAgent.run(tree, sessionHistory, onProgress):
   a. Flattens tree to get all components
   b. For each component:
      - Calls Groq to generate TSX code
      - Calls validate_tsx_syntax tool → fixes if needed
      - Calls check_accessibility tool → fixes if needed
      - Yields { componentId, componentName, code }
   c. Orchestrator emits component_ready event → UI adds to Code Export
9. SummarizerAgent.run(tree, generatedCodes):
   a. Reads context from AgentMemory
   b. Generates developer summary report
10. Orchestrator emits summary_ready then done event (100%)
11. useGenerate hook sets status = 'done'
12. User can view tree, browse code, copy, or Export ZIP
```

---

## 5. Prompt Engineering Strategy

Four specialized prompts are used in sequence, each with a specific role:

| Prompt | Model instruction | Output format |
|---|---|---|
| System prompt | "You are a senior frontend architect specializing in React and Tailwind" | Sets context for all calls |
| PRD parse prompt | Extract pages, features, user roles, data entities, app type | Strict JSON only |
| Component plan prompt | Generate full ComponentTree matching exact Zod schema | Strict JSON only |
| Component code prompt | Generate TSX with TypeScript interface, Tailwind classes, aria attributes | Raw TSX only |

All prompts instruct the model to return **only** the requested format — no markdown fences, no explanation. Zod validation catches and surfaces any format deviations.

---

## 6. Tech Stack with Versions

| Technology | Version | Role |
|---|---|---|
| Next.js | 14.x | Framework, App Router, API routes |
| TypeScript | 5.x | End-to-end type safety |
| Tailwind CSS | 3.x | Styling (app UI + generated code) |
| Groq SDK | 0.x | AI API client |
| Llama 3.3 70B | — | Language model via Groq (free) |
| Zod | 3.x | Schema validation for AI outputs |
| Monaco Editor | 4.x | PRD input editor |
| Framer Motion | 11.x | Tree view animations |
| React Syntax Highlighter | 15.x | Code display |
| JSZip | 3.x | ZIP file generation |
| StackBlitz SDK | 1.x | Live preview |
| next-themes | 0.x | Dark/light mode |
