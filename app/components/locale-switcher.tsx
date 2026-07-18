import { setLocale } from "@/app/actions";
import { locales, type Locale } from "@/lib/i18n/dictionaries";

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border text-xs font-medium">
      {locales.map((l) => (
        <form key={l} action={setLocale.bind(null, l)}>
          <button
            type="submit"
            aria-current={l === locale}
            className={
              l === locale
                ? "bg-foreground px-2 py-1.5 uppercase text-background"
                : "px-2 py-1.5 uppercase text-muted transition-colors hover:text-foreground"
            }
          >
            {l}
          </button>
        </form>
      ))}
    </div>
  );
}
