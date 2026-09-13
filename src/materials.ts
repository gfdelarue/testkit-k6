import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

export const PINNED_GO_MODULE_ACQUISITION_TRANSPORT_POLICY = Object.freeze({
  attempts: 2,
  fallbackEnvironment: Object.freeze({ GODEBUG: "http2client=0" }),
  retryCondition: "official-go-module-endpoint-http2-peer-internal-error",
});
export const PINNED_GO_MODULE_ACQUISITION_ATTEMPTS =
  PINNED_GO_MODULE_ACQUISITION_TRANSPORT_POLICY.attempts;
export const K6_SOURCE_GENERATION_TIMEOUT_MS = 30 * 60 * 1_000;
const PINNED_GO_MODULE_ACQUISITION_RETRY_DELAY_MS = 250;
const OFFICIAL_GO_HTTP2_PEER_INTERNAL_ERROR =
  /https:\/\/(?:proxy|sum)\.golang\.org\/[^\r\n]*stream error: stream ID \d+; INTERNAL_ERROR; received from peer/u;
const NON_RETRYABLE_GO_DIAGNOSTICS = Object.freeze([
  /\bchecksum mismatch\b/iu,
  /\bSECURITY ERROR\b/u,
  /\bx509:/iu,
  /\bunknown authority\b/iu,
  /\bcertificate\b/iu,
  /\bTLS(?: handshake| verification)?\b/iu,
  /\bcompil(?:e|ed|ation)(?: error| failed| failure)\b/iu,
  /\bsyntax error\b/iu,
  /\bundefined:/iu,
  /\bcannot use\b/iu,
  /\btoo many errors\b/iu,
  /\bbuild constraints exclude\b/iu,
  /\bpermission denied\b/iu,
  /\bauthentication required\b/iu,
]);

export async function runPinnedK6SourceGeneration({
  createArguments,
  createEnvironment,
  now = performance.now.bind(performance),
  onRetry = defaultRetryReporter,
  runAttempt,
  sleep = defaultSleep,
  temporaryRoot,
  timeoutMs = K6_SOURCE_GENERATION_TIMEOUT_MS,
}) {
  requireFunction(createArguments, "createArguments");
  requireFunction(createEnvironment, "createEnvironment");
  requireFunction(runAttempt, "runAttempt");
  if (typeof temporaryRoot !== "string" || temporaryRoot.length === 0) {
    throw new TypeError(
      "Pinned k6 source generation requires a temporary root",
    );
  }
  return runPinnedGoModuleAcquisition({
    createEnvironment: (transportEnvironment, attempt) => {
      const paths = sourceGenerationAttemptPaths(temporaryRoot, attempt);
      fs.mkdirSync(paths.foundryParent, { recursive: true });
      return createEnvironment({
        ...transportEnvironment,
        TEMP: paths.foundryParent,
        TMP: paths.foundryParent,
        TMPDIR: paths.foundryParent,
      });
    },
    now,
    onRetry,
    operationLabel: "Pinned xk6 source generation",
    runAttempt: async ({
      attempt,
      environment,
      timeoutMs: remainingTimeoutMs,
      transportFallback,
    }) => {
      const paths = sourceGenerationAttemptPaths(temporaryRoot, attempt);
      await runAttempt({
        arguments: createArguments(paths.generatorOutput),
        attempt,
        environment,
        generatorOutput: paths.generatorOutput,
        timeoutMs: remainingTimeoutMs,
        transportFallback,
      });
      const foundryDirectories = fs
        .readdirSync(paths.foundryParent, { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && entry.name.startsWith("k6foundry"),
        )
        .map((entry) => path.join(paths.foundryParent, entry.name));
      if (foundryDirectories.length !== 1) {
        throw new Error(
          `Pinned xk6 source generation attempt ${attempt.toString()} created ${foundryDirectories.length.toString()} foundry directories`,
        );
      }
      return Object.freeze({
        attempt,
        generatorOutput: paths.generatorOutput,
        sourceTree: foundryDirectories[0],
        transportFallback,
      });
    },
    sleep,
    timeoutMs,
  });
}

export async function runPinnedGoModuleAcquisition({
  createEnvironment,
  now = performance.now.bind(performance),
  onRetry = defaultRetryReporter,
  operationLabel = "Pinned Go module acquisition",
  runAttempt,
  sleep = defaultSleep,
  timeoutMs,
}) {
  requireFunction(createEnvironment, "createEnvironment");
  requireFunction(now, "now");
  requireFunction(onRetry, "onRetry");
  requireFunction(runAttempt, "runAttempt");
  requireFunction(sleep, "sleep");
  if (typeof operationLabel !== "string" || operationLabel.length === 0) {
    throw new TypeError("Pinned Go module acquisition label must be non-empty");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(
      "Pinned Go module acquisition timeout must be a positive safe integer",
    );
  }

  const startedAt = now();
  for (
    let attempt = 1;
    attempt <= PINNED_GO_MODULE_ACQUISITION_ATTEMPTS;
    attempt += 1
  ) {
    remainingDuration(timeoutMs, startedAt, now(), operationLabel);
    const transportFallback = attempt > 1;
    const environment = createEnvironment(
      transportFallback
        ? PINNED_GO_MODULE_ACQUISITION_TRANSPORT_POLICY.fallbackEnvironment
        : {},
      attempt,
    );
    const remainingTimeoutMs = remainingDuration(
      timeoutMs,
      startedAt,
      now(),
      operationLabel,
    );
    try {
      const result = await runAttempt({
        attempt,
        environment,
        timeoutMs: remainingTimeoutMs,
        transportFallback,
      });
      remainingDuration(timeoutMs, startedAt, now(), operationLabel);
      return result;
    } catch (error) {
      const retryable =
        attempt === 1 && isRetryableGoModuleHttp2PeerFailure(error);
      if (!retryable) throw error;
      const remainingBeforeDelay = remainingDuration(
        timeoutMs,
        startedAt,
        now(),
        operationLabel,
      );
      if (remainingBeforeDelay <= PINNED_GO_MODULE_ACQUISITION_RETRY_DELAY_MS) {
        throw error;
      }
      onRetry({
        attempt,
        error,
        nextAttempt: attempt + 1,
        operationLabel,
      });
      let remainingAfterReport;
      try {
        remainingAfterReport = remainingDuration(
          timeoutMs,
          startedAt,
          now(),
          operationLabel,
        );
      } catch {
        throw error;
      }
      if (remainingAfterReport <= PINNED_GO_MODULE_ACQUISITION_RETRY_DELAY_MS) {
        throw error;
      }
      await sleep(PINNED_GO_MODULE_ACQUISITION_RETRY_DELAY_MS);
      try {
        remainingDuration(timeoutMs, startedAt, now(), operationLabel);
      } catch {
        throw error;
      }
    }
  }

  throw new Error(`${operationLabel} exhausted its attempts`);
}

export function isRetryableGoModuleHttp2PeerFailure(error) {
  if (typeof error !== "object" || error === null) return false;
  const result = Reflect.get(error, "result");
  if (typeof result !== "object" || result === null) return false;
  if (
    !Number.isInteger(Reflect.get(result, "exitCode")) ||
    Reflect.get(result, "exitCode") === 0 ||
    Reflect.get(result, "exitSignal") !== null ||
    Reflect.get(result, "timedOut") !== false ||
    Reflect.get(result, "cancelled") !== false ||
    Reflect.get(result, "outputLimitExceeded") !== false ||
    Reflect.get(result, "terminationError") !== null ||
    Reflect.get(result, "error") !== null
  ) {
    return false;
  }
  const stdout = Reflect.get(result, "stdout");
  const stderr = Reflect.get(result, "stderr");
  const diagnostic = `${typeof stdout === "string" ? stdout : ""}\n${typeof stderr === "string" ? stderr : ""}`;
  return (
    OFFICIAL_GO_HTTP2_PEER_INTERNAL_ERROR.test(diagnostic) &&
    !NON_RETRYABLE_GO_DIAGNOSTICS.some((pattern) => pattern.test(diagnostic))
  );
}

function remainingDuration(totalMs, startedAt, currentTime, operationLabel) {
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(currentTime) ||
    currentTime < startedAt
  ) {
    throw new Error(`${operationLabel} received an invalid monotonic clock`);
  }
  const remaining = totalMs - (currentTime - startedAt);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new Error(`${operationLabel} exhausted its total deadline`);
  }
  return Math.max(1, Math.floor(remaining));
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(
      `Pinned Go module acquisition ${name} must be a function`,
    );
  }
}

function defaultRetryReporter({ operationLabel }: Record<string, any>) {
  console.warn(
    `${operationLabel} attempt 1/${PINNED_GO_MODULE_ACQUISITION_ATTEMPTS.toString()} hit a verified Go module HTTP/2 peer failure; retrying once over HTTP/1.1 within the same bounded operation`,
  );
}

function sourceGenerationAttemptPaths(temporaryRoot, attempt) {
  const attemptRoot = path.join(temporaryRoot, `attempt-${attempt.toString()}`);
  return {
    foundryParent: path.join(attemptRoot, "foundry"),
    generatorOutput: path.join(attemptRoot, "generator-k6"),
  };
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
