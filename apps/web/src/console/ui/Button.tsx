"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { Spinner } from "./Feedback";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-rv-orange text-white hover:bg-rv-orange-hi active:bg-[#e65a0f] disabled:bg-rv-orange/40 disabled:text-white/60",
  secondary:
    "bg-rv-card text-white/85 border border-rv-line hover:bg-rv-raised hover:text-white disabled:text-white/35",
  ghost: "text-white/70 hover:bg-white/[0.06] hover:text-white disabled:text-white/30",
  danger: "bg-rv-red/15 text-rv-red border border-rv-red/30 hover:bg-rv-red/25 disabled:opacity-50",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-9 px-4 text-sm gap-2 rounded-md",
  /** The page's one big action (e.g. on an empty page). */
  lg: "h-11 px-5 text-[15px] gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors select-none disabled:cursor-not-allowed",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === "sm" ? 12 : size === "lg" ? 16 : 14} /> : icon}
      {children}
    </button>
  );
});

/** Square icon-only button. Always pass `label` (used for aria-label and tooltip). */
export function IconButton({
  label,
  children,
  className,
  active,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
        active ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
