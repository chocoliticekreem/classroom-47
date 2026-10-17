"use client";
// Console tab: Workflows. n8n-style editor for the agent's flows (see ../workflows/Editor.tsx).
import WorkflowEditor from "../workflows/Editor";

export default function WorkflowsTab() {
  return (
    <div className="absolute inset-0 min-h-0">
      <WorkflowEditor />
    </div>
  );
}
