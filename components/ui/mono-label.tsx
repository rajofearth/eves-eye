import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const monoLabelVariants = cva(
  "font-mono uppercase tracking-widest leading-none",
  {
    variants: {
      variant: {
        default: "text-muted-foreground",
        silver: "text-foreground",
        muted: "text-muted-foreground/60",
        warning: "text-amber-500 dark:text-amber-400",
        critical: "text-destructive",
        nominal: "text-emerald-500 dark:text-emerald-400",
        primary: "text-primary",
      },
      size: {
        "2xs": "text-[8px]",
        xs: "text-[10px]",
        sm: "text-xs",
        default: "text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "xs",
    },
  },
);

function MonoLabel({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof monoLabelVariants>) {
  return (
    <span
      data-slot="mono-label"
      className={cn(monoLabelVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { MonoLabel, monoLabelVariants };
