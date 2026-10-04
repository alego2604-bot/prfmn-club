import { cloneElement, forwardRef, isValidElement, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { parseMoneyInput } from "@/lib/money";
import { isoToDisplay, maskDateTyping, parseDisplayDate } from "@/lib/dates";

const control =
  "w-full rounded-lg border border-line bg-surface px-3 text-[14px] text-fg shadow-xs outline-none transition-[border,box-shadow] placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus:ring-[3px] focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-3";

export function Field({ label, hint, error, children, className, required, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; required?: boolean; htmlFor?: string }) {
  const autoId = useId();
  // Asocia la etiqueta al control (accesibilidad y tests) cuando el hijo es un único elemento sin id propio
  const child = isValidElement<{ id?: string }>(children) && !htmlFor && typeof children.type !== "string" ? children : null;
  const id = htmlFor ?? (child ? child.props.id ?? autoId : undefined);
  if (child && !child.props.id) children = cloneElement(child, { id });
  htmlFor = id;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg-2">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-danger-fg">{error}</p> : hint ? <p className="text-xs text-fg-3">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; leading?: ReactNode; trailing?: ReactNode }>(
  function Input({ className, invalid, leading, trailing, ...rest }, ref) {
    if (leading || trailing) {
      return (
        <div className={cn("relative flex items-center", className)}>
          {leading && <span className="pointer-events-none absolute left-3 text-fg-3">{leading}</span>}
          <input ref={ref} className={cn(control, "h-9", leading && "pl-9", trailing && "pr-10", invalid && "border-danger")} {...rest} />
          {trailing && <span className="absolute right-3 text-sm text-fg-3">{trailing}</span>}
        </div>
      );
    }
    return <input ref={ref} className={cn(control, "h-9", invalid && "border-danger", className)} {...rest} />;
  },
);

/**
 * Fecha siempre en formato español (dd/mm/aaaa), sea cual sea el idioma del navegador; el valor sigue siendo ISO
 * (aaaa-mm-dd), igual que `<input type="date">`, así que ni el almacenamiento ni la validación cambian.
 * - Se escribe con el teclado numérico (las barras se ponen solas) y se valida al salir del campo.
 * - El botón de calendario abre el selector nativo (en móvil e iPad, la rueda del sistema).
 * - `onChange` recibe `{ target: { value } }` como el input nativo: «» si se vacía, ISO si la fecha es válida.
 */
export function DateInput({ value, onChange, min, max, id, className, size, disabled, required, invalid, ...aria }: {
  value: string | undefined;
  onChange?(e: { target: { value: string } }): void;
  min?: string;
  max?: string;
  id?: string;
  className?: string;
  size?: "sm";
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const [text, setText] = useState(() => isoToDisplay(value));
  const [bad, setBad] = useState(false);
  const native = useRef<HTMLInputElement>(null);
  // Cambios desde fuera (otro campo, reinicio del formulario): se refleja el nuevo valor
  useEffect(() => {
    if (parseDisplayDate(text) !== (value || null)) {
      setText(isoToDisplay(value));
      setBad(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const emit = (iso: string) => {
    if (iso !== (value ?? "")) onChange?.({ target: { value: iso } });
  };
  const outOfRange = (iso: string) => (!!min && iso < min) || (!!max && iso > max);
  const commit = (t: string) => {
    if (!t.trim()) {
      setBad(false);
      return emit("");
    }
    const iso = parseDisplayDate(t);
    if (!iso) return setBad(true);
    setText(isoToDisplay(iso));
    setBad(outOfRange(iso));
    emit(iso);
  };
  const h = size === "sm" ? "h-8" : "h-9";
  return (
    <div className={cn("relative", className)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        value={text}
        disabled={disabled}
        required={required}
        aria-invalid={bad || invalid || undefined}
        aria-label={aria["aria-label"]}
        aria-describedby={aria["aria-describedby"]}
        title={bad ? "Fecha no válida: escribe día/mes/año, por ejemplo 04/10/2026" : undefined}
        onChange={(e) => {
          const next = maskDateTyping(e.target.value, text);
          setText(next);
          const iso = parseDisplayDate(next);
          if (iso && /\d{4}$/.test(next)) { // al teclear, solo con el año completo (con dos cifras, al salir)
            setBad(outOfRange(iso));
            emit(iso);
          } else if (!next) emit("");
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
        className={cn(control, h, "pr-9 num", (bad || invalid) && "border-danger focus:border-danger focus:ring-danger/15")}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Abrir calendario"
        title="Abrir calendario"
        onClick={() => {
          const el = native.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
            el.click();
          }
        }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-fg-3 transition-colors hover:text-fg disabled:pointer-events-none"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
      <input
        ref={native}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value ?? ""}
        min={min}
        max={max}
        onChange={(e) => {
          setText(isoToDisplay(e.target.value));
          setBad(false);
          emit(e.target.value);
        }}
        className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
      />
    </div>
  );
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-[88px] py-2 leading-relaxed", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(control, "h-9 appearance-none pr-9")} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
    </div>
  );
}

/** Entrada de dinero: el usuario escribe "2,50" y el valor es 250 céntimos. */
export function MoneyInput({ value, onChange, className, placeholder = "0,00", autoFocus, id, invalid }: { value: number | null; onChange: (cents: number | null) => void; className?: string; placeholder?: string; autoFocus?: boolean; id?: string; invalid?: boolean }) {
  const [text, setText] = useState(value === null ? "" : (value / 100).toFixed(2).replace(".", ","));
  useEffect(() => {
    const parsed = parseMoneyInput(text);
    if (parsed !== value) setText(value === null ? "" : (value / 100).toFixed(2).replace(".", ","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      autoFocus={autoFocus}
      className={cn("num", className)}
      placeholder={placeholder}
      invalid={invalid}
      value={text}
      trailing="€"
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseMoneyInput(e.target.value));
      }}
      onBlur={() => value !== null && setText((value / 100).toFixed(2).replace(".", ","))}
    />
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start justify-between gap-4", disabled && "cursor-not-allowed opacity-60")}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium">{label}</span>}
          {description && <span className="block text-xs text-fg-3">{description}</span>}
        </span>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}
      >
        <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </button>
    </label>
  );
}

export function Checkbox({ checked, onChange, indeterminate, label, className }: { checked: boolean; onChange: (v: boolean) => void; indeterminate?: boolean; label?: string; className?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate;
      }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className={cn("h-4 w-4 cursor-pointer rounded border-line-strong accent-[var(--accent)]", className)}
    />
  );
}
