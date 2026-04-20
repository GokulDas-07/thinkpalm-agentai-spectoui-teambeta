"use client";

import sdk from "@stackblitz/sdk";
import type { ComponentNode, ComponentTree } from "@/types/component-tree";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { TreeView } from "./TreeView";

const EMPTY_ROOTS: ComponentNode[] = [];

export interface ComponentPreviewProps {
  componentTree: ComponentTree | null;
  generatedCodes: Record<string, string>;
  statusMessage: string;
  isLoading: boolean;
}

function findNodeById(
  nodes: ComponentNode[],
  id: string | null,
): ComponentNode | null {
  if (!id) {
    return null;
  }
  for (const n of nodes) {
    if (n.id === id) {
      return n;
    }
    if (n.children?.length) {
      const found = findNodeById(n.children, id);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function filePathForComponentId(id: string): string {
  const safe = id.replace(/[^\w.-]+/g, "_");
  return `src/generated/${safe}.tsx`;
}

const STACKBLITZ_BASE_FILES: Record<string, string> = {
  "package.json": `{
  "name": "spectoui-preview",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "framer-motion": "^12.0.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.2"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.1",
    "tailwindcss": "^3.4.1",
    "postcss": "^8.4.35",
    "autoprefixer": "^10.4.18",
    "typescript": "~5.6.0",
    "vite": "^5.4.0"
  }
}`,
  "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`,
  "tailwind.config.js": `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
`,
  "postcss.config.js": `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
  "src/index.css": `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
  "index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SpecToUI Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["src"]
}`,
  "src/main.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen p-10 bg-white">
          <div className="max-w-2xl mx-auto p-6 border-2 border-red-200 bg-red-50 rounded-xl shadow-sm">
            <h2 className="text-red-800 text-lg font-bold flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Preview Runtime Error
            </h2>
            <p className="mt-2 text-red-700 text-sm">
              One or more components crashed during rendering. This usually happens when a component attempts to access missing data or props.
            </p>
            <div className="mt-4 p-4 bg-white border border-red-100 rounded-lg overflow-auto">
              <pre className="text-xs text-red-600 font-mono">
                {this.state.error?.stack || this.state.error?.message}
              </pre>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
`,
  "src/App.tsx": `export default function App() {
  return (
    <main className="min-h-screen p-8 bg-zinc-50 flex items-center justify-center">
      <div className="text-center p-8 bg-white rounded-2xl shadow-sm border border-zinc-200 max-w-sm w-full">
        <div className="mx-auto w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <h1 className="text-xl font-bold text-zinc-900">Initializing Preview</h1>
        <p className="mt-2 text-zinc-600 text-sm">
          Generating your UI components. The preview will update automatically as soon as the first component is ready.
        </p>
      </div>
    </main>
  );
}
`,

};

function sanitizeName(name: string): string {
  return name.replace(/[^\w]/g, "");
}

function sanitizeCode(code: string): string {
  // 1. Try to extract from triple backticks (handles partial/streaming blocks)
  const match = code.match(
    /```(?:tsx|ts|jsx|js|javascript|typescript)?\s*\n?([\s\S]*?)(?:```|$)/i,
  );
  if (match && match[1].trim()) {
    return match[1].trim();
  }

  // 2. If no fences found, check if it starts with conversational filler
  // If we identify filler and code hasn't started, we return empty string
  // to avoid crashing the preview with plain text.
  const codeMarkers = ["import ", "export ", "const ", "function "];
  let minIndex = Infinity;
  for (const marker of codeMarkers) {
    const idx = code.indexOf(marker);
    if (idx !== -1 && idx < minIndex) minIndex = idx;
  }

  if (minIndex !== Infinity) {
    return code.slice(minIndex).trim();
  }

  // 3. Fallback: if it's very short and contains no code keywords/JSX, it's probably filler
  if (code.length < 150 && !code.includes("<") && !code.includes("{")) {
    return "";
  }

  return code.trim();
}

function generateAppTsx(
  roots: ComponentNode[],
  generatedCodes: Record<string, string>,
): string {
  const readyRoots = roots.filter((node) => !!generatedCodes[node.id]);

  if (readyRoots.length === 0) {
    return STACKBLITZ_BASE_FILES["src/App.tsx"];
  }

  const importsArr = readyRoots.map((node) => {
    const safeId = node.id.replace(/[^\w.-]+/g, "_");
    const safeName = sanitizeName(node.name);
    return `import ${safeName} from "./generated/${safeId}";`;
  });
  const imports = Array.from(new Set(importsArr)).join("\n");

  const components = readyRoots
    .map((node) => `<${sanitizeName(node.name)} />`)
    .join("\n      ");

  return `
${imports}

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-50 p-8 flex flex-col gap-12">
      ${components}
    </div>
  );
}
`.trim();
}

function openStackBlitzWithCodes(
  componentTree: ComponentTree | null,
  generatedCodes: Record<string, string>,
) {
  const files: Record<string, string> = { ...STACKBLITZ_BASE_FILES };
  for (const [id, code] of Object.entries(generatedCodes)) {
    files[filePathForComponentId(id)] = code;
  }
  if (componentTree?.rootComponents) {
    files["src/App.tsx"] = generateAppTsx(
      componentTree.rootComponents,
      generatedCodes,
    );
  }

  sdk.openProject({
    title: "SpecToUI Preview",
    template: "node",
    files,
  });
}

function EmbeddedPreview({
  componentTree,
  generatedCodes,
}: {
  componentTree: ComponentTree | null;
  generatedCodes: Record<string, string>;
}) {
  const containerId = useId();
  const vmRef = useRef<any>(null);
  const embeddedRef = useRef(false);

  useEffect(() => {
    const element = document.getElementById(containerId);
    if (!element || embeddedRef.current) return;

    embeddedRef.current = true;

    const files: Record<string, string> = { ...STACKBLITZ_BASE_FILES };
    for (const [id, code] of Object.entries(generatedCodes)) {
      files[filePathForComponentId(id)] = sanitizeCode(code);
    }
    if (componentTree?.rootComponents) {
      files["src/App.tsx"] = generateAppTsx(
        componentTree.rootComponents,
        generatedCodes,
      );
    }

    sdk.embedProject(element, {
      title: "SpecToUI Preview",
      template: "node",
      files,
    }, {
      height: "100%",
      width: "100%",
      hideExplorer: true,
      hideNavigation: true,
      view: "preview",
    }).then(vm => {
      vmRef.current = vm;
    });
  }, [containerId]);

  useEffect(() => {
    if (!vmRef.current) return;

    const files: Record<string, string> = {};
    for (const [id, code] of Object.entries(generatedCodes)) {
      files[filePathForComponentId(id)] = sanitizeCode(code);
    }
    if (componentTree?.rootComponents) {
      files["src/App.tsx"] = generateAppTsx(
        componentTree.rootComponents,
        generatedCodes,
      );
    }

    vmRef.current.applyFsDiff({
      create: files,
      destroy: [],
    });
  }, [componentTree, generatedCodes]);

  return <div id={containerId} className="h-full w-full overflow-hidden" />;
}

export function ComponentPreview({
  componentTree,
  generatedCodes,
  statusMessage,
  isLoading,
}: ComponentPreviewProps) {
  const [activeTab, setActiveTab] = useState<"tree" | "preview">("tree");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const roots = componentTree?.rootComponents ?? EMPTY_ROOTS;
  const selectedNode = useMemo(
    () => findNodeById(roots, selectedNodeId),
    [roots, selectedNodeId],
  );

  const hasGenerated = Object.keys(generatedCodes).length > 0;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-white dark:bg-zinc-950">
      {isLoading ? (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/80 dark:bg-zinc-950/80"
          role="status"
          aria-live="polite"
        >
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"
            aria-hidden
          />
          <p className="max-w-sm px-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
            {statusMessage}
          </p>
        </div>
      ) : null}

      <div className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "tree"
              ? "border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
          onClick={() => setActiveTab("tree")}
        >
          Tree
        </button>
        <button
          type="button"
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "preview"
              ? "border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
          onClick={() => setActiveTab("preview")}
        >
          Preview
        </button>
      </div>

      {activeTab === "tree" ? (
        <div className="flex min-h-0 flex-1">
          <aside className="w-64 shrink-0 overflow-y-auto border-r border-zinc-200 dark:border-zinc-800">
            {roots.length > 0 ? (
              <TreeView
                nodes={roots}
                selectedId={selectedNodeId}
                onSelect={setSelectedNodeId}
              />
            ) : (
              <p className="p-3 text-xs text-zinc-500 dark:text-zinc-400">
                No component tree yet.
              </p>
            )}
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {selectedNode ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {selectedNode.name}
                  </h2>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      selectedNode.type === "layout"
                        ? "bg-purple-100 text-purple-700"
                        : selectedNode.type === "section"
                          ? "bg-blue-100 text-blue-700"
                          : selectedNode.type === "ui"
                            ? "bg-green-100 text-green-700"
                            : selectedNode.type === "form"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {selectedNode.type}
                  </span>
                </div>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {selectedNode.description}
                </p>

                <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Props
                </h3>
                <div className="mt-2 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full min-w-[280px] text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-100 text-left dark:border-zinc-700 dark:bg-zinc-800">
                        <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-200">
                          name
                        </th>
                        <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-200">
                          type
                        </th>
                        <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-200">
                          required
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedNode.props.length === 0 ? (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-3 py-2 text-zinc-500 dark:text-zinc-400"
                          >
                            No props declared.
                          </td>
                        </tr>
                      ) : (
                        selectedNode.props.map((p, i) => (
                          <tr
                            key={`${p.name}-${i}`}
                            className={
                              i % 2 === 0
                                ? "bg-white dark:bg-zinc-950"
                                : "bg-zinc-50 dark:bg-zinc-900/60"
                            }
                          >
                            <td className="px-3 py-2 font-mono text-xs text-zinc-900 dark:text-zinc-100">
                              {p.name}
                            </td>
                            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                              {p.type}
                            </td>
                            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                              {p.required ? "yes" : "no"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Tailwind classes
                </h3>
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedNode.tailwindClasses.length === 0 ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      None
                    </span>
                  ) : (
                    selectedNode.tailwindClasses.map((c) => (
                      <code
                        key={c}
                        className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                      >
                        {c}
                      </code>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Select a component in the tree to see details.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          {hasGenerated ? (
            <div className="flex h-full w-full flex-col">
              <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Interactive Preview (Powered by StackBlitz)
                </span>
                <button
                  type="button"
                  className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() =>
                    openStackBlitzWithCodes(componentTree, generatedCodes)
                  }
                >
                  Open in New Tab
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <EmbeddedPreview
                  componentTree={componentTree}
                  generatedCodes={generatedCodes}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No components generated yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
