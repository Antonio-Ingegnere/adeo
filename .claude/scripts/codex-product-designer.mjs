#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const UX_ROOT = path.join(REPO_ROOT, "ui-ux", "ux");
const MODEL = "gpt-5.6-sol";
const EFFORT = "high";
const JOB_ROOT = path.join(
  os.tmpdir(),
  `adeo-codex-product-designer-${crypto.createHash("sha256").update(REPO_ROOT).digest("hex").slice(0, 12)}`,
);

function usage() {
  return [
    "Usage:",
    "  node .claude/scripts/codex-product-designer.mjs preflight [--json]",
    "  node .claude/scripts/codex-product-designer.mjs start --prompt-file <path> [--json]",
    "  node .claude/scripts/codex-product-designer.mjs resume --job <job-id> --prompt-file <path> [--json]",
    "  node .claude/scripts/codex-product-designer.mjs status [job-id] [--json]",
    "  node .claude/scripts/codex-product-designer.mjs result <job-id> [--json]",
    "  node .claude/scripts/codex-product-designer.mjs cancel <job-id> [--json]",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--prompt-file" || argument === "--job") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      throw new Error(`Unsupported option ${argument}. Model, effort, sandbox, and working root are enforced by this wrapper.`);
    }
    positionals.push(argument);
  }
  return { options, positionals };
}

function ensureJobRoot() {
  fs.mkdirSync(JOB_ROOT, { recursive: true, mode: 0o700 });
}

function validateJobId(jobId) {
  if (!/^design-[a-z0-9-]+$/.test(jobId ?? "")) {
    throw new Error(`Invalid Product Designer job id: ${jobId ?? "<missing>"}`);
  }
  return jobId;
}

function jobPath(jobId) {
  return path.join(JOB_ROOT, `${validateJobId(jobId)}.json`);
}

function logPath(jobId) {
  return path.join(JOB_ROOT, `${validateJobId(jobId)}.log`);
}

function readJob(jobId) {
  const target = jobPath(jobId);
  if (!fs.existsSync(target)) {
    throw new Error(`No Product Designer Codex job found for ${jobId}.`);
  }
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function writeJob(job) {
  ensureJobRoot();
  const target = jobPath(job.id);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ ...job, updatedAt: new Date().toISOString() }, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
}

function listJobs() {
  ensureJobRoot();
  return fs.readdirSync(JOB_ROOT)
    .filter((entry) => /^design-[a-z0-9-]+\.json$/.test(entry))
    .map((entry) => JSON.parse(fs.readFileSync(path.join(JOB_ROOT, entry), "utf8")))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function generateJobId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14).toLowerCase();
  return `design-${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

function resolvePromptFile(value) {
  if (!value) {
    throw new Error("--prompt-file is required. Inline prompts are deliberately disabled so Claude leaves an auditable handoff.");
  }
  const target = path.resolve(process.cwd(), value);
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    throw new Error(`Prompt file is not a regular file: ${target}`);
  }
  return target;
}

function codexVersion() {
  const result = spawnSync("codex", ["--version"], { encoding: "utf8" });
  return {
    available: result.status === 0,
    version: result.status === 0 ? result.stdout.trim() : null,
    error: result.status === 0 ? null : (result.stderr || result.error?.message || "Codex is unavailable").trim(),
  };
}

function preflight() {
  const required = [
    path.join(UX_ROOT, "AGENTS.md"),
    path.join(REPO_ROOT, ".claude", "agents", "product-designer.md"),
    path.join(UX_ROOT, "principles.md"),
    path.join(UX_ROOT, "patterns.md"),
    path.join(UX_ROOT, "responsive.md"),
    path.join(UX_ROOT, "accessibility.md"),
    path.join(UX_ROOT, "content.md"),
    path.join(UX_ROOT, "component-inventory.md"),
  ];
  const codex = codexVersion();
  const missing = required.filter((target) => !fs.existsSync(target));
  return {
    ready: codex.available && missing.length === 0,
    codex,
    repoRoot: REPO_ROOT,
    workingRoot: UX_ROOT,
    sandbox: "workspace-write",
    approvalPolicy: "never",
    model: MODEL,
    effort: EFFORT,
    instructionFile: path.join(UX_ROOT, "AGENTS.md"),
    missing,
    jobRoot: JOB_ROOT,
  };
}

function output(value, asJson = false) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${value}\n`);
}

function renderJob(job) {
  const lines = [
    `${job.id}: ${job.status}${job.phase ? ` (${job.phase})` : ""}`,
    `Model: ${job.model} / ${job.effort}`,
    `Working root: ${job.workingRoot}`,
  ];
  if (job.sessionId) lines.push(`Session: ${job.sessionId}`);
  if (job.sourceJobId) lines.push(`Continues: ${job.sourceJobId}`);
  if (job.error) lines.push(`Error: ${job.error}`);
  lines.push(`Log: ${job.logFile}`);
  return lines.join("\n");
}

function launch(command, options) {
  const check = preflight();
  if (!check.ready) {
    throw new Error(`Product Designer Codex preflight failed: ${JSON.stringify(check)}`);
  }
  const promptFile = resolvePromptFile(options["prompt-file"]);
  let sourceJob = null;
  if (command === "resume") {
    sourceJob = readJob(options.job);
    if (sourceJob.status !== "completed" || !sourceJob.sessionId) {
      throw new Error(`Job ${sourceJob.id} cannot be resumed until it completed with a Codex session id.`);
    }
  }

  const id = generateJobId();
  const now = new Date().toISOString();
  const job = {
    id,
    status: "queued",
    phase: command === "resume" ? "queued-continuation" : "queued-new-session",
    createdAt: now,
    updatedAt: now,
    pid: null,
    codexPid: null,
    sessionId: sourceJob?.sessionId ?? null,
    sourceJobId: sourceJob?.id ?? null,
    promptFile,
    model: MODEL,
    effort: EFFORT,
    sandbox: "workspace-write",
    approvalPolicy: "never",
    workingRoot: UX_ROOT,
    logFile: logPath(id),
    finalMessage: null,
    error: null,
  };
  writeJob(job);
  fs.writeFileSync(job.logFile, "", { mode: 0o600 });

  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "worker", "--job", id], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  const current = readJob(id);
  writeJob({ ...current, pid: current.pid ?? child.pid ?? null });
  return readJob(id);
}

function appendLog(target, text) {
  fs.appendFileSync(target, text);
}

function consumeEvent(job, line) {
  if (!line.trim()) return job;
  try {
    const event = JSON.parse(line);
    if (event.type === "thread.started" && event.thread_id) {
      return { ...job, sessionId: event.thread_id, phase: "running" };
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      return { ...job, finalMessage: event.item.text ?? job.finalMessage, phase: "running" };
    }
    if (event.type === "turn.completed") {
      return { ...job, phase: "finalizing" };
    }
    if (event.type === "turn.failed") {
      return { ...job, error: event.error?.message ?? "Codex turn failed", phase: "failed" };
    }
    return job;
  } catch {
    return job;
  }
}

async function runWorker(jobId) {
  let job = readJob(jobId);
  const prompt = fs.readFileSync(job.promptFile, "utf8");
  const common = [
    "-c", `model_reasoning_effort=\"${EFFORT}\"`,
    "-c", "approval_policy=\"never\"",
    "--model", MODEL,
    "--json",
    "-",
  ];
  const args = job.sourceJobId
    ? ["exec", "resume", ...common.slice(0, -1), job.sessionId, "-"]
    : [
        "exec",
        "--sandbox", "workspace-write",
        "--cd", UX_ROOT,
        ...common,
      ];

  job = { ...job, status: "running", phase: job.sourceJobId ? "resuming-session" : "starting-session", pid: process.pid };
  writeJob(job);
  appendLog(job.logFile, `$ codex ${args.map((value) => JSON.stringify(value)).join(" ")}\n`);

  const child = spawn("codex", args, { cwd: UX_ROOT, stdio: ["pipe", "pipe", "pipe"], env: process.env });
  job = { ...job, codexPid: child.pid ?? null };
  writeJob(job);
  child.stdin.end(prompt);

  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    appendLog(job.logFile, text);
    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) job = consumeEvent(job, line);
    writeJob(job);
  });
  child.stderr.on("data", (chunk) => appendLog(job.logFile, chunk.toString()));

  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
  } catch (error) {
    writeJob({
      ...job,
      status: "failed",
      phase: "failed",
      completedAt: new Date().toISOString(),
      codexPid: null,
      error: error.message,
    });
    throw error;
  }
  if (stdoutBuffer) job = consumeEvent(job, stdoutBuffer);
  const completed = exitCode === 0 && Boolean(job.sessionId);
  writeJob({
    ...job,
    status: completed ? "completed" : "failed",
    phase: completed ? "completed" : "failed",
    completedAt: new Date().toISOString(),
    codexPid: null,
    error: completed ? job.error : (job.error ?? `Codex exited with status ${exitCode}. See ${job.logFile}`),
  });
  process.exitCode = completed ? 0 : 1;
}

function cancel(jobId) {
  const job = readJob(jobId);
  if (!["queued", "running"].includes(job.status)) return job;
  if (job.pid) {
    try {
      process.kill(-job.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  const canceled = {
    ...job,
    status: "canceled",
    phase: "canceled",
    completedAt: new Date().toISOString(),
    codexPid: null,
  };
  writeJob(canceled);
  return canceled;
}

async function main() {
  const command = process.argv[2];
  const { options, positionals } = parseArgs(process.argv.slice(3));
  if (!command || command === "help" || command === "--help") {
    output(usage());
    return;
  }
  if (command === "worker") {
    await runWorker(options.job);
    return;
  }
  if (command === "preflight") {
    const report = preflight();
    output(options.json ? report : [
      `Ready: ${report.ready}`,
      `Codex: ${report.codex.version ?? report.codex.error}`,
      `Model: ${report.model} / ${report.effort}`,
      `Working root: ${report.workingRoot}`,
      `Sandbox: ${report.sandbox}; approvals: ${report.approvalPolicy}`,
      `Instructions: ${report.instructionFile}`,
      `Missing: ${report.missing.length ? report.missing.join(", ") : "none"}`,
    ].join("\n"), options.json);
    if (!report.ready) process.exitCode = 1;
    return;
  }
  if (command === "start" || command === "resume") {
    const job = launch(command, options);
    output(options.json ? job : `${renderJob(job)}\nCheck with: node .claude/scripts/codex-product-designer.mjs status ${job.id}`, options.json);
    return;
  }
  const jobId = positionals[0];
  if (command === "status") {
    if (jobId) {
      const job = readJob(jobId);
      output(options.json ? job : renderJob(job), options.json);
    } else {
      const jobs = listJobs();
      output(options.json ? jobs : (jobs.length ? jobs.map(renderJob).join("\n\n") : "No Product Designer Codex jobs."), options.json);
    }
    return;
  }
  if (command === "result") {
    const job = readJob(jobId);
    if (options.json) output(job, true);
    else if (job.status === "completed") output(job.finalMessage ?? `Codex completed without a final text message. Log: ${job.logFile}`);
    else output(`${renderJob(job)}\nResult is only available after completion.`);
    if (job.status !== "completed") process.exitCode = 1;
    return;
  }
  if (command === "cancel") {
    const job = cancel(jobId);
    output(options.json ? job : renderJob(job), options.json);
    return;
  }
  throw new Error(`Unknown command ${command}.\n${usage()}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
