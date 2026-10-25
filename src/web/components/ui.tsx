import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type StatTone = "neutral" | "primary" | "success" | "warning" | "danger";

const statToneClasses: Record<StatTone, string> = {
  neutral: "text-[var(--text)]",
  primary: "text-[var(--primary)]",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--danger)]",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  href?: string;
}) {
  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${statToneClasses[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link
        to={href}
        aria-label={label}
        className="block rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-lg shadow-black/20 transition hover:border-[var(--border-strong)]"
      >
        {content}
      </Link>
    );
  }

  return (
    <section
      aria-label={label}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-lg shadow-black/20"
    >
      {content}
    </section>
  );
}

type StatusStyle = { label: string; className: string };

const STATUS_STYLES: Record<string, StatusStyle> = {
  queued: {
    label: "Na fila",
    className: "bg-[var(--sunken)] text-[var(--text)] ring-1 ring-inset ring-[var(--border)]",
  },
  running: {
    label: "Em execução",
    className: "bg-[var(--primary)] text-[var(--on-primary)]",
  },
  succeeded: {
    label: "Concluída",
    className: "bg-[var(--success)] text-[var(--on-success)]",
  },
  partial: {
    label: "Parcial",
    className: "bg-[var(--warning)] text-[var(--on-warning)]",
  },
  failed: {
    label: "Falhou",
    className: "bg-[var(--danger)] text-[var(--on-danger)]",
  },
  cancelled: {
    label: "Cancelada",
    className: "bg-[var(--sunken)] text-[var(--text-muted)] ring-1 ring-inset ring-[var(--border)]",
  },
  posted: {
    label: "Publicada",
    className: "bg-[var(--success)] text-[var(--on-success)]",
  },
  fallback: {
    label: "Fallback",
    className: "bg-[var(--warning)] text-[var(--on-warning)]",
  },
};

export function StatusBadge({ status, kind }: { status: string; kind?: "job" | "review" }) {
  const style = STATUS_STYLES[status] ?? {
    label: status,
    className: "bg-[var(--sunken)] text-[var(--text)] ring-1 ring-inset ring-[var(--border)]",
  };
  return (
    <span
      data-kind={kind ?? "job"}
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  );
}


export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-lg shadow-black/20 ${className ?? ''}`}>
      {title ? <h2 className="mb-3 text-sm font-semibold tracking-wide text-[var(--text)]">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block font-medium text-[var(--text)]">{label}</span>
      {children}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 disabled:opacity-50 ${className ?? ""}`}
    />
  );
}

type ButtonVariant = "primary" | "secondary" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]",
  secondary: "border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--border)]",
  danger: "border border-[var(--danger)] bg-transparent text-[var(--danger)] hover:bg-[var(--danger)] hover:text-[var(--on-danger)] active:bg-[var(--danger-active)]",
};

export function Button({ children, className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`rounded-lg px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="mb-3 text-sm text-[var(--danger)]">
      {children}
    </p>
  ) : null;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-[var(--text-muted)]">{children}</p>;
}
