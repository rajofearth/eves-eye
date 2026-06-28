import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const statusDotVariants = cva("inline-block shrink-0 rounded-full", {
  variants: {
    variant: {
      nominal: "bg-emerald-500 border border-emerald-600/30",
      warning: "bg-amber-500",
      critical: "bg-destructive",
      silver: "bg-primary",
      muted: "bg-muted-foreground/60",
      inactive: "bg-muted",
    },
    size: {
      xs: "size-1",
      sm: "size-1.5",
      default: "size-2",
      lg: "size-2.5",
    },
    pulse: {
      true: "animate-pulse",
      false: "",
    },
  },
  defaultVariants: {
    variant: "nominal",
    size: "sm",
    pulse: false,
  },
});

export interface StatusDotProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof statusDotVariants> {}

function StatusDot({
  className,
  variant,
  size,
  pulse,
  ...props
}: StatusDotProps) {
  return (
    <span
      data-slot="status-dot"
      className={cn(statusDotVariants({ variant, size, pulse }), className)}
      {...props}
    />
  );
}

function StatusIndicator({
  className,
  variant = "nominal",
  pulse = false,
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusDotVariants>) {
  const textColor = {
    nominal: "text-foreground",
    warning: "text-amber-500 dark:text-amber-400",
    critical: "text-destructive",
    silver: "text-foreground",
    muted: "text-muted-foreground",
    inactive: "text-muted-foreground/60",
  }[variant ?? "nominal"];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-xs uppercase",
        textColor,
        className,
      )}
      {...props}
    >
      <StatusDot variant={variant} pulse={pulse ?? false} />
      {children}
    </span>
  );
}

export { StatusDot, StatusIndicator, statusDotVariants };
