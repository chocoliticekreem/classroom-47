"use client";
// Three big ways in: New case, Practice a playbook, Open the live city.
import type { ComponentType, ReactNode } from "react";
import { IconCity, IconExecutions, IconWorkflow, useConsole, type IconProps } from "../ui";

function Tile({
  icon: Icon,
  title,
  line,
  onClick,
  href,
  trailing,
}: {
  icon: ComponentType<IconProps>;
  title: string;
  line: string;
  onClick?: () => void;
  href?: string;
  trailing?: ReactNode;
}) {
  const cls =
    "group flex items-center gap-4 rounded-xl border border-white/[0.07] bg-rv-card px-5 py-5 text-left transition-colors hover:border-rv-orange/50 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rv-orange";
  const inner = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-rv-orange/10 text-rv-orange">
        <Icon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-[13px] text-white/50">{line}</span>
      </span>
      {trailing}
    </>
  );
  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export default function Shortcuts() {
  const { navigate } = useConsole();
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Tile icon={IconExecutions} title="New case" line="Give Hamyway City a problem to handle" onClick={() => navigate("intake")} />
      <Tile icon={IconWorkflow} title="Practice a playbook" line="Try the steps on test cases" onClick={() => navigate("workflows")} />
      <Tile
        icon={IconCity}
        title="Open the live city"
        line="Watch deliveries go wrong live"
        href="/city"
      />
    </div>
  );
}
