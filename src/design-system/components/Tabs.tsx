import { cn } from "@/lib/utils";

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex gap-1 rounded-xl bg-surface p-1 border border-border-subtle">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            value === opt.value ? "bg-accent text-accent-contrast" : "text-text-secondary hover:text-text-primary"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
