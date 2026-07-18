import Link from "next/link";
import { logout } from "@/app/actions";
import { isAuthenticated } from "@/lib/auth";
import { getDictionary, type Locale } from "@/lib/i18n";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";

export async function Header({ locale }: { locale: Locale }) {
  const dict = await getDictionary();
  const authenticated = await isAuthenticated();
  const navLink =
    "text-muted transition-colors hover:text-foreground";

  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-3">
      <div className="flex items-baseline gap-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          stellwerk<span className="text-muted">-ai</span>
        </Link>
        {authenticated && (
          <nav className="flex items-baseline gap-4 text-sm">
            <Link href="/matching" className={navLink}>
              {dict.nav.matching}
            </Link>
            <Link href="/runs" className={navLink}>
              {dict.nav.runs}
            </Link>
            <Link href="/candidates" className={navLink}>
              {dict.nav.candidates}
            </Link>
            <Link href="/jobs" className={navLink}>
              {dict.nav.jobs}
            </Link>
          </nav>
        )}
      </div>
      <div className="flex items-center gap-2">
        {authenticated && (
          <>
            <Link
              href="/settings/prompt"
              title={dict.promptLab.heading}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-muted hover:text-foreground"
            >
              {dict.promptLab.navLabel}
            </Link>
            <Link
              href="/settings"
              title={dict.settings.toSettings}
              className="rounded-md border border-border p-1.5 text-muted transition-colors hover:text-foreground"
            >
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
              </svg>
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="px-2 text-sm text-muted transition-colors hover:text-foreground"
              >
                {dict.nav.signOut}
              </button>
            </form>
          </>
        )}
        <LocaleSwitcher locale={locale} />
        <ThemeToggle label={dict.theme.toggle} />
      </div>
    </header>
  );
}
