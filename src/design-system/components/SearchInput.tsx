import { InputHTMLAttributes } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
      <input
        className="h-10 w-full rounded-xl border border-border-subtle bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50 focus:outline-none"
        {...props}
      />
    </div>
  );
}
