import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const sizeClasses = { sm: "h-7 w-7 text-xs", md: "h-9 w-9 text-sm", lg: "h-14 w-14 text-lg" }[size];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent",
        sizeClasses
      )}
    >
      {initials(name)}
    </div>
  );
}
