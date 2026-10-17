"use client";
// "Show on playbook": opens Playbooks with this case run selected, so its path lights up and plays.
import { useContext } from "react";
import { Button, ConsoleContext, IconWorkflow, type ButtonProps } from "./ui";

/** Link to a case run on its playbook canvas (same tab). */
export function playbookRunHref(executionId: string): string {
  return `/?tab=workflows&run=${encodeURIComponent(executionId)}`;
}

export function ShowOnPlaybook({ executionId, size = "sm", variant = "secondary", className, label = "Show on playbook", feedback = false }: {
  executionId: string | null | undefined;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
  label?: string;
  feedback?: boolean;
}) {
  const ctx = useContext(ConsoleContext); // null outside the console shell (e.g. /review)
  if (!executionId) return null;
  return (
    <Button
      size={size} variant={variant} className={className}
      icon={<IconWorkflow size={15} />}
      title="See the steps this case went through on its playbook"
      onClick={() => {
        if (ctx) ctx.navigate("workflows", { run: executionId, ...(feedback ? { panel: "practice" } : {}) });
        else window.location.assign(playbookRunHref(executionId) + (feedback ? "&panel=practice" : ""));
      }}
    >
      {label}
    </Button>
  );
}
