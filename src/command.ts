import { spawn, type SpawnOptions } from "node:child_process";

export interface CommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  label: string;
  timeoutMs: number;
}

export interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export async function runManagedCommand(
  command: string,
  arguments_: readonly string[],
  options: CommandOptions & SpawnOptions,
): Promise<CommandResult> {
  const { cwd, env, label, timeoutMs, ...spawnOptions } = options;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...arguments_], {
      cwd,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${label} exceeded its deadline`));
        return;
      }
      if (code === 0) {
        resolve({ exitCode: 0, stderr, stdout });
        return;
      }
      reject(
        new Error(
          signal
            ? `${label} terminated by ${signal}`
            : `${label} exited with code ${String(code ?? 1)}${stdout || stderr ? `\n${stdout}${stderr}` : ""}`,
        ),
      );
    });
  });
}

export async function runManagedStreamingCommand(
  command: string,
  arguments_: readonly string[],
  options: CommandOptions,
): Promise<void> {
  await runManagedCommand(command, arguments_, {
    ...options,
    stdio: "inherit",
  });
}
