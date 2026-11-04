// Errors worth someone's attention go to Sentry, when the build says where (VITE_SENTRY_DSN).
// Its code downloads in the background, and only then: it never delays the first page.

const dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN;

// from here on, uncaught errors and rejected promises are reported too
const sentry = dsn
  ? import("./sentry")
      .then((Sentry) => {
        Sentry.init({ dsn, environment: import.meta.env.MODE });
        return Sentry;
      })
      .catch(() => null) // couldn't download it (offline): nothing to report with
  : null;

export function report(error: unknown) {
  void sentry?.then((Sentry) => Sentry?.captureException(error));
}
