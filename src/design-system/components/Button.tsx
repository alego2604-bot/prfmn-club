import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:brightness-95 active:brightness-90",
  secondary: "bg-surface-raised text-text-primary border border-border hover:bg-white/5",
  ghost: "text-text-secondary hover:text-text-primary hover:bg-white/5",
  destructive: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-xl gap-2",
  lg: "h-12 px-5 text-base rounded-xl gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
