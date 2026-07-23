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
    <div className="max-w-full overflow-x-auto scrollbar-thin">
      <div className="inline-flex gap-1 rounded-xl border border-border-subtle bg-surface p-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              value === opt.value ? "bg-accent text-accent-contrast" : "text-text-secondary hover:text-text-primary"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
