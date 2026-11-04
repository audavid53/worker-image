import { Component, StrictMode, Suspense, lazy, type ReactNode } from "react";

/** Shows a prototype's error on the page instead of a blank screen. */
class ShowError extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <pre style={{ padding: 16, color: "#e5484d", whiteSpace: "pre-wrap" }}>{String(this.state.error.stack ?? this.state.error)}</pre> : this.props.children;
  }
}
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ProjectProvider } from "./data/project";
import { LibraryProvider } from "./data/library";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/story.css";
import "./styles/script.css";
import "./styles/shots.css";
import "./styles/timeline.css";
import "./styles/library.css";

// Template test benches (lazy, so they never weigh on the studio bundle): ?prototype=explainer
const ExplainerTest = lazy(async () => {
  await import("./prototypes/explainer/explainer.css");
  return { default: (await import("./prototypes/explainer/ExplainerTest")).ExplainerTest };
});
const prototype = new URLSearchParams(location.search).get("prototype");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {prototype === "explainer" ? (
      <ShowError>
        <Suspense fallback={<p style={{ padding: 16 }}>Loading test bench…</p>}>
          <ExplainerTest />
        </Suspense>
      </ShowError>
    ) : (
      <LibraryProvider>
        <ProjectProvider>
          <App />
        </ProjectProvider>
      </LibraryProvider>
    )}
  </StrictMode>,
);
