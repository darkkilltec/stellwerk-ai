"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Refreshes the server-rendered run page while the worker is busy; goes
// quiet as soon as the run reaches a terminal status.
export function RunPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
