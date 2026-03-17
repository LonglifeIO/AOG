/**
 * Setup signal handlers for graceful shutdown.
 */
export function setupSignalHandlers(cleanup: () => Promise<void>): void {
  let cleaning = false;

  const handler = async (signal: string) => {
    if (cleaning) return;
    cleaning = true;

    console.error(`\nReceived ${signal}, cleaning up...`);

    try {
      await cleanup();
    } catch (error) {
      console.error("Cleanup error:", error);
    }

    process.exit(signal === "SIGTERM" ? 0 : 1);
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function generateTaskId(): string {
  return Math.random().toString(36).slice(2, 10);
}
