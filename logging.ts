/**
 * logging.ts — обёртка над console.error с опциональной отправкой в Sentry.
 *
 * Sentry включается только если задан SENTRY_DSN (бесплатный тир Sentry).
 * Без переменной окружения logError() ведёт себя как обычный console.error —
 * локальная разработка и тесты не требуют никакой настройки.
 */

import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;
export const sentryEnabled = Boolean(dsn);

if (sentryEnabled) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0,
  });
}

export function logError(label: string, error?: unknown) {
  console.error(label, error);
  if (sentryEnabled) {
    Sentry.captureException(error ?? new Error(label), { extra: { label } });
  }
}

export function reportClientCrash(report: {
  exceptionType: string;
  stackHash: string;
  appVersion: string;
  androidSdk: number;
  stage: "startup" | "runtime" | "background";
}) {
  console.warn("Android client crash", report);
  if (sentryEnabled) {
    Sentry.captureMessage(`Android crash: ${report.exceptionType}`, {
      level: "error",
      fingerprint: ["android", report.stackHash],
      tags: {
        appVersion: report.appVersion,
        androidSdk: String(report.androidSdk),
        stage: report.stage,
      },
    });
  }
}
