export type LoggerLike = {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

export function createLogger(custom?: Partial<LoggerLike>): LoggerLike {
  const base: LoggerLike = console as any;
  return {
    debug: (...args: any[]) => (custom?.debug ?? base.debug).apply(base, args),
    info: (...args: any[]) => (custom?.info ?? base.info).apply(base, args),
    warn: (...args: any[]) => (custom?.warn ?? base.warn).apply(base, args),
    error: (...args: any[]) => (custom?.error ?? base.error).apply(base, args),
  };
}
