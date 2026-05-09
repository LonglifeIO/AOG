const emitted = new Set<string>();

/**
 * Print a stderr notice once per process keyed on `key`. Subsequent calls
 * with the same key are no-ops. Used for deprecation warnings and council
 * fallback notices ("running solo," "use_worktree forced").
 */
export function noticeOnce(key: string, message: string): void {
  if (emitted.has(key)) return;
  emitted.add(key);
  console.error(message);
}

/**
 * Test-only: reset the dedup set so each test run starts clean.
 */
export function _resetNoticesForTests(): void {
  emitted.clear();
}
