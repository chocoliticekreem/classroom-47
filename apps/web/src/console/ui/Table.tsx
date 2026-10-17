import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Dense data table. Usage:
 *   <Table><thead><tr><Th>Case</Th><Th align="right">Cost</Th></tr></thead>
 *   <tbody><Tr onClick={...} selected={...}><Td>…</Td><Td align="right">…</Td></Tr></tbody></Table>
 * Wrap in a scroll container; the header is sticky.
 */
export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cx("w-full border-separate border-spacing-0 text-[13px]", className)} {...rest}>
      {children}
    </table>
  );
}

type Align = "left" | "right" | "center";
const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

export function Th({
  align = "left",
  className,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cx(
        "sticky top-0 z-[1] h-9 border-b border-rv-line bg-rv-panel px-3 text-rv-caption font-medium whitespace-nowrap text-white/50",
        ALIGN[align],
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Tr({
  onClick,
  selected,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(e as unknown as React.MouseEvent<HTMLTableRowElement>);
              }
            }
          : undefined
      }
      tabIndex={onClick ? 0 : undefined}
      aria-selected={selected || undefined}
      className={cx(
        "group",
        onClick && "cursor-pointer",
        selected ? "bg-rv-orange/[0.08]" : onClick && "hover:bg-white/[0.03]",
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function Td({
  align = "left",
  className,
  children,
  mono,
  muted,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align; mono?: boolean; muted?: boolean; children?: ReactNode }) {
  return (
    <td
      className={cx(
        "h-11 border-b border-white/[0.05] px-3 align-middle",
        ALIGN[align],
        mono && "font-mono text-[12px]",
        muted ? "text-white/50" : "text-white/85",
        align === "right" && "tabular",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}
