import { redirect } from "next/navigation";
import { connection } from "next/server";
import { DbStatusCard } from "@/app/components/db-status-card";
import { LoginForm } from "@/app/components/login-form";
import { isAuthenticated } from "@/lib/auth";
import { getDbStatus, type DbStatus } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";

export default async function Home() {
  // Defer rendering to request time so `next build` (which runs during the
  // Docker image build, without a database) doesn't try to prerender this.
  await connection();

  // The tool's job is matching — signed-in users land there directly.
  if (await isAuthenticated()) {
    redirect("/matching");
  }

  const dict = await getDictionary();
  let status: DbStatus | null = null;
  let error: string | null = null;
  try {
    status = await getDbStatus();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Local-testing aid only: never present in production builds.
  const devPassword =
    process.env.NODE_ENV === "development"
      ? process.env.APP_PASSWORD
      : undefined;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <LoginForm t={dict.login} devPassword={devPassword} />
      <div className="w-full max-w-sm">
        <DbStatusCard status={status} error={error} dict={dict} />
      </div>
    </main>
  );
}
