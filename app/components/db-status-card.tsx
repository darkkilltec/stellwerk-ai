import type { DbStatus } from "@/lib/db";
import type { Dictionary } from "@/lib/i18n";

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block size-1.5 shrink-0 rounded-full ${ok ? "bg-ok" : "bg-danger"}`}
    />
  );
}

// The visible proof of the reliability line (healthcheck, migrations,
// extension) — kept from the original ping page by design.
export function DbStatusCard({
  status,
  error,
  dict,
}: {
  status: DbStatus | null;
  error: string | null;
  dict: Dictionary;
}) {
  const t = dict.status;
  // Width is the parent's concern — the card adapts to login page and
  // settings page alike.
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
        {t.heading}
      </h2>
      {status ? (
        <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-6 gap-y-2.5 text-sm">
          <dt className="text-muted">{t.database}</dt>
          <dd className="flex items-center gap-2 font-mono text-[13px]">
            <Dot ok /> {status.database}
          </dd>
          <dt className="text-muted">{t.postgres}</dt>
          <dd className="font-mono text-[13px]">{status.postgresVersion}</dd>
          <dt className="text-muted">{t.pgvector}</dt>
          <dd className="flex items-center gap-2 font-mono text-[13px]">
            <Dot ok={!!status.vectorVersion} />
            {status.vectorVersion ?? t.notInstalled}
          </dd>
          <dt className="text-muted">{t.tables}</dt>
          <dd className="flex items-center gap-2 font-mono text-[13px]">
            <Dot ok={status.tables.length > 0} />
            <span>
              {status.tables.length > 0
                ? status.tables.join(", ")
                : t.noMigrations}
            </span>
          </dd>
        </dl>
      ) : (
        <p className="flex items-start gap-2 text-sm text-danger">
          <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-danger" />
          <span>
            {t.unreachable} {error}
          </span>
        </p>
      )}
    </section>
  );
}
