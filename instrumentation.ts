export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./db/migrate");
    await runMigrations();
    console.log("[db] migrations applied");
    const { resumeInterruptedRuns } = await import("./lib/evaluation/worker");
    await resumeInterruptedRuns();
  }
}
