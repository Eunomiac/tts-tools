/**
 * Serializes async import/sync work so overlapping loadingANewGame / pushObject
 * cannot interleave executeLua return waiters.
 */
export class ImportMutex {
  private tail: Promise<void> = Promise.resolve();

  runExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}
