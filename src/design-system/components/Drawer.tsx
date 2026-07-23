import { ReactNode } from "react";
import { X } from "lucide-react";

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div className="h-full w-full max-w-md overflow-y-auto border-l border-border-subtle bg-surface-raised p-5 scrollbar-thin">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
