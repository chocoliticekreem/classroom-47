/**
 * Hamyway console UI kit. Import everything from "@/console/ui" (or "../ui" inside console/).
 *
 * LOOK (docs/plans/ui-simplify-brief.md): calm, flat, one dark theme, system font. No gradients,
 * glows, glass or sparkles. Hamyway orange (rv-orange #ff6a1a) is the ONE accent: the page's one
 * primary button, the selected tab, focus rings. Everything else is greys + status colours.
 *
 * SURFACES (darkest -> lightest): bg-rv-sidebar #19191d, bg-rv-canvas #1f1f23 (page),
 *   bg-rv-panel #222227, bg-rv-card #26262b, bg-rv-raised #303037 (hover). Borders: border-rv-line.
 * STATUS COLOURS (one meaning each, everywhere):
 *   Sent = rv-green · Asked = rv-blue · Needs a person = rv-amber · Stopped = rv-red ·
 *   Didn't finish = rv-grey. (rv-violet only for dataset labels.)
 * SPACING (Tailwind steps): 1=4 2=8 3=12 4=16 6=24 8=32 12=48 px. gap-2/3 inside a control,
 *   gap-4 between controls, gap-6 between cards, gap-8..12 between page sections; cards p-5/p-6.
 * TYPE: text-rv-hero 40 · text-rv-big 30 (big numbers) · text-rv-title 18 (section headings) ·
 *   text-rv-heading 15 · text-rv-body 14 · text-rv-small 13 · text-rv-caption 12 (grey captions).
 * FOCUS: every focusable element gets an orange ring on keyboard focus (globals.css). Use real
 *   <button>/<a>; give icon-only buttons a label (IconButton does). Motion is off for
 *   prefers-reduced-motion.
 * Utility classes: `tabular` (tabular numerals), `rv-skeleton`, `rv-pulse`, `rv-dotgrid`.
 *
 * Words people read come from the shared glossary "@/ui/plain" (plainNode, plainOutcome,
 * plainGate, riskWord, cents, plainCaseType, plainDataset, plainStatus, plainStep). Never show raw
 * node types, model names, config keys or JSON on main screens.
 *
 * ---------------------------------------------------------------------------------------------
 * NEW (dashboard v2) — prefer these for page content
 *   <BigNumber value label sub? status? tone="default|orange|muted" size="md|lg" loading? onClick?/>
 *       big number with a word: <BigNumber value={12} label="Sent" status="acted" />
 *   <StatusPill status label? count? size="sm|md"/>   coloured chip for any raw value:
 *       acted/success/allow -> Sent (green), asked_for_info -> Asked (blue),
 *       escalated/ask -> Needs a person (amber), blocked/block -> Stopped (red),
 *       error/null -> Didn't finish (grey), no_action -> Nothing to do, running -> Working on it.
 *       Helpers: statusKind(raw) -> StatusKind, statusLabel(raw), STATUS_TEXT_CLASS / STATUS_FILL_CLASS /
 *       STATUS_WORDS maps (Record<StatusKind, class|string>).
 *   <SectionCard title description? action? footer? flush?>  roomy page card (heading 18px)
 *   <EmptyState icon? title description? action? | actionLabel+onAction compact?/>
 *   <ProgressBar value max?=1 label? showValue? countMode? status? tone? size="sm|md|lg"/>
 *       value null = indeterminate; role="progressbar" with aria values.
 *   <Skeleton className/>  <SkeletonText lines/>  <SkeletonRows rows/>  <SkeletonCard lines?/>
 *   <KeyValue items={[{label, value, hint?}]} columns={1|2|3}/>   empty values show "—"
 *   Toasts: const toast = useToast(); toast.success("Case sent"); toast.error("Couldn't save",
 *       { description, action: { label, onClick }, duration }); toast("Saved"); toast.dismiss(id).
 *       Plain toast() works outside React too. <Toaster/> is already mounted by the Shell.
 *   <Button size="lg">  big button for the one main action on an empty page.
 * ---------------------------------------------------------------------------------------------
 *
 * Layout / navigation (provided by console/Shell.tsx)
 *   useConsole()  -> { tab, params, navigate(tab, params?), setParams(patch), workflowId, workflowName, headerSlot }
 *   <HeaderActions>  portal your page's ONE primary button into the header
 *   TAB_IDS, TAB_TITLES, isTabId, type TabId
 *
 * Buttons
 *   <Button variant="primary|secondary|ghost|danger" size="sm|md|lg" icon loading>
 *   <IconButton label active>       square icon-only button with tooltip
 *   <ExecuteButton onExecuted?>     primary "Run a case" + case picker; POSTs /api/console/execute,
 *                                   then opens Case runs (?tab=executions&id=...). stripCaseNo(title)
 *
 * Badges (honesty rule: anything with `simulated: true` MUST show <SimulatedBadge/>)
 *   <SimulatedBadge/> "Practice case"   <RealBadge/> "Live"   <ProvenanceBadge simulated/>
 *   <Badge tone="neutral|orange|green|red|amber|blue|violet" dot>   generic chip
 *   <StatusDot tone pulse/>  <ExecStatusBadge status/> (Working on it / Finished / Didn't finish)
 *   <PassBadge pass score/>  <GateBadge gate/> (OK / Ask a person / Stop)  <DatasetBadge dataset/>
 *   <Code>  inline code chip (Advanced views only)
 *
 * Containers:  <Panel title subtitle actions flush>  <PanelHeader/>  <KpiCard/>  <Meter ratio tone/>
 * Tables:      <Table> + <Th align> + <Tr onClick selected> + <Td align mono muted>  (sticky header)
 * Feedback:    <EmptyState/>  <NoRunsYet/> ("No cases yet")  <ErrorState error onRetry/>  <Spinner/>
 *
 * Icons (inline SVG, size + currentColor)
 *   IconOverview IconWorkflow IconExecutions IconEvidence IconCity IconPlay IconRefresh
 *   IconImport IconExternal IconChevronLeft/Right/Down IconCheck IconX IconAlert IconCoin
 *   IconClock IconCases IconTarget IconShield IconInbox IconSearch IconSidebar RivetMark
 *   (new) IconHome IconNewCase IconRuns IconDecisions IconReality IconSettings IconPlus IconInfo
 *   IconArrowRight IconSend
 *
 * Formatting + maths (pure, tested in format.test.ts)
 *   formatUsd formatDuration formatPct formatCount formatRelative formatTimestamp humanize DASH
 *   computeKpis(rows, recordedCriticalFailures?) -> Kpis (excludes simulated datasets;
 *   outcomes = tested cases per outcome)   cx(...classes)
 *
 * Data hooks live in console/useApi.ts (useStatus, useEvidence, useExecutions, useExecution,
 * useWorkflows, useCases, consoleApi.execute/importRuns/saveWorkflow, useAction, getJson).
 */
export * from "./Badge";
export * from "./Blocks";
export * from "./Button";
export * from "./context";
export * from "./cx";
export * from "./ExecuteButton";
export * from "./Feedback";
export * from "./format";
export * from "./icons";
export * from "./kpis";
export * from "./Panel";
export * from "./Status";
export * from "./Table";
export * from "./Toast";
