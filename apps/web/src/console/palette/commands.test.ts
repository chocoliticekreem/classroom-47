import { describe, expect, it, vi, type Mock } from "vitest";
import { buildCommands, searchCommands, shortSetLabel, type PaletteActions } from "./commands";

type Mocked = { [K in keyof PaletteActions]: Mock<PaletteActions[K]> };
function actions(): Mocked {
  return {
    navigate: vi.fn<PaletteActions["navigate"]>(),
    openDecisions: vi.fn<PaletteActions["openDecisions"]>(),
    runCase: vi.fn<PaletteActions["runCase"]>(),
    practice: vi.fn<PaletteActions["practice"]>(),
    openCity: vi.fn<PaletteActions["openCity"]>(),
    trigger: vi.fn<PaletteActions["trigger"]>(),
  };
}

const data = {
  cases: [
    { id: "delivery-024", dataset: "public", title: "Fridge stuck at the depot" },
    { id: "gen-007", dataset: "generated", title: null },
  ],
  runs: [{ id: "exec-abc", caseId: "delivery-024", startedAt: "2026-10-10T10:00:00Z", status: "success", simulated: false }],
  sets: [
    { id: "quick", label: "Quick: 5 public cases, one per scene", count: 5 },
    { id: "city", label: "City cases: closures", count: 50 },
    { id: "custom", label: "Custom case ids", count: 0 },
  ],
  canPractice: true,
};

const find = (cmds: ReturnType<typeof buildCommands>, id: string) => {
  const c = cmds.find((x) => x.id === id);
  if (!c) throw new Error(`no command ${id}`);
  return c;
};

describe("buildCommands", () => {
  it("has a jump to every tab (New case as its own action) plus Decisions", () => {
    const ids = buildCommands(actions()).map((c) => c.id);
    for (const t of ["overview", "executions", "workflows", "evidence", "reality", "city", "settings"]) expect(ids).toContain(`tab:${t}`);
    expect(ids).not.toContain("tab:intake");
    expect(ids).toContain("new-case");
    expect(ids).toContain("decisions");
  });

  it("wires navigation, decisions, city and triggers to the right callbacks", () => {
    const a = actions();
    const cmds = buildCommands(a, data);
    void find(cmds, "tab:evidence").run();
    expect(a.navigate).toHaveBeenLastCalledWith("evidence");
    void find(cmds, "new-case").run();
    expect(a.navigate).toHaveBeenLastCalledWith("intake");
    void find(cmds, "decisions").run();
    expect(a.openDecisions).toHaveBeenCalled();
    void find(cmds, "open-city").run();
    expect(a.openCity).toHaveBeenCalled();
    void find(cmds, "trigger:truck_crash").run();
    void find(cmds, "trigger:motorcade").run();
    expect(a.trigger.mock.calls).toEqual([["truck_crash"], ["motorcade"]]);
  });

  it("makes Run case and Open case run commands from live data", () => {
    const a = actions();
    const cmds = buildCommands(a, data);
    const run = find(cmds, "run:public:delivery-024");
    expect(run.title).toBe("Run case delivery-024");
    void run.run();
    expect(a.runCase).toHaveBeenCalledWith(data.cases[0]);
    const open = find(cmds, "exec:exec-abc");
    expect(open.title).toBe("Open case run delivery-024");
    void open.run();
    expect(a.navigate).toHaveBeenLastCalledWith("executions", { id: "exec-abc" });
  });

  it("offers Practice per set, skipping custom/empty sets and needing a playbook", () => {
    const a = actions();
    const cmds = buildCommands(a, data);
    expect(find(cmds, "practice:quick").title).toBe("Practice on Quick");
    expect(cmds.some((c) => c.id === "practice:custom")).toBe(false);
    void find(cmds, "practice:city").run();
    expect(a.practice).toHaveBeenCalledWith(data.sets[1]);
    expect(buildCommands(a, { ...data, canPractice: false }).some((c) => c.group === "Practice")).toBe(false);
  });

  it("has unique ids", () => {
    const ids = buildCommands(actions(), data).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("searchCommands", () => {
  const cmds = buildCommands(actions(), data);

  it("hides long lists (cases, runs) until the person types", () => {
    const empty = searchCommands("", cmds).map((r) => r.item.id);
    expect(empty).toContain("new-case");
    expect(empty.some((id) => id.startsWith("run:") || id.startsWith("exec:"))).toBe(false);
  });

  it("finds a case by number and by its title", () => {
    expect(searchCommands("run 024", cmds)[0].item.id).toBe("run:public:delivery-024");
    expect(searchCommands("fridge", cmds)[0].item.id).toBe("run:public:delivery-024");
  });

  it("puts the obvious command first", () => {
    expect(searchCommands("new case", cmds)[0].item.id).toBe("new-case");
    expect(searchCommands("motorcade", cmds)[0].item.id).toBe("trigger:motorcade");
    expect(searchCommands("truck", cmds)[0].item.id).toBe("trigger:truck_crash");
    expect(searchCommands("settings", cmds)[0].item.id).toBe("tab:settings");
    expect(searchCommands("open case run", cmds)[0].item.id).toBe("exec:exec-abc");
  });
});

describe("shortSetLabel", () => {
  it("keeps the part before the colon", () => {
    expect(shortSetLabel("Quick: 5 public cases")).toBe("Quick");
    expect(shortSetLabel("Generated hard cases")).toBe("Generated hard cases");
  });
});
