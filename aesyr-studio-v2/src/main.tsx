import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ProjectProvider } from "./data/project";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/story.css";
import "./styles/script.css";
import "./styles/shots.css";
import "./styles/timeline.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProjectProvider>
      <App />
    </ProjectProvider>
  </StrictMode>,
);
