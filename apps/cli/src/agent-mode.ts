import { Context } from "effect"

/**
 * Agent operability for the spiko CLI:
 *
 * - AI coding agents are detected through a table-driven registry of
 *   environment variables so agents get machine-first output without extra
 *   flags.
 * - `--agent` / `--no-agent` arguments override detection; environment
 *   overrides sit in between.
 * - Agent mode only changes output shape (envelopes, JSON help), never the
 *   command grammar.
 */

/** Structural subset of `process.env` so detection is testable without mutation. */
export type EnvironmentVariables = Readonly<Record<string, string | undefined>>

/** Service carrying the resolved agent-mode flag for the current run. */
export const AgentMode = Context.Reference<boolean>("spiko/cli/AgentMode", {
  defaultValue: () => false,
})

export interface AgentDetector {
  readonly envVars: ReadonlyArray<string>
  readonly name: string
}

/**
 * Table-driven AI agent detection, checked in priority order. The variable
 * names follow the well-known markers exported by each agent. The generic
 * `AGENT` entry stays last: it matches any agent harness that sets it.
 */
const agentDetectors: ReadonlyArray<AgentDetector> = [
  { name: "claude-code", envVars: ["CLAUDECODE", "CLAUDE_CODE"] },
  { name: "cursor", envVars: ["CURSOR_AGENT"] },
  { name: "codex", envVars: ["CODEX", "OPENAI_CODEX"] },
  { name: "opencode", envVars: ["OPENCODE"] },
  { name: "aider", envVars: ["AIDER"] },
  { name: "cline", envVars: ["CLINE"] },
  { name: "windsurf", envVars: ["WINDSURF_AGENT"] },
  { name: "github-copilot", envVars: ["GITHUB_COPILOT"] },
  { name: "amazon-q", envVars: ["AMAZON_Q", "AWS_Q_DEVELOPER"] },
  { name: "gemini-code", envVars: ["GEMINI_CODE_ASSIST"] },
  { name: "sourcegraph-cody", envVars: ["SRC_CODY"] },
  { name: "pi-dev", envVars: ["PI_CODING_AGENT"] },
  { name: "generic-agent", envVars: ["AGENT"] },
]

const isEnvTruthy = (value: string | undefined): boolean =>
  value !== undefined && (value.toLowerCase() === "1" || value.toLowerCase() === "true")

const isEnvPresent = (value: string | undefined): boolean => value !== undefined && value !== ""

/**
 * Detect a named AI agent from its well-known environment variables. Returns
 * the detector name when found, otherwise undefined.
 */
export const detectAgentName = (env: EnvironmentVariables = process.env): string | undefined => {
  for (const detector of agentDetectors) {
    if (detector.envVars.some((envVar) => isEnvTruthy(env[envVar]))) {
      return detector.name
    }
  }
  // Devin exposes a session id rather than a boolean marker.
  return isEnvPresent(env["DEVIN_SESSION_ID"]) ? "devin" : undefined
}

/**
 * Resolve agent mode from explicit argument-level overrides first, then the
 * `SPIKO_AGENT_MODE` / `FORCE_AGENT_MODE` overrides (where a recognized
 * falsy value forces mode off), then auto-detection. `explicit` comes from
 * parsed `--agent` / `--no-agent` arguments where `false` means "--no-agent"
 * was passed.
 */
export const resolveAgentMode = (
  explicit: boolean | undefined,
  env: EnvironmentVariables = process.env,
): boolean => {
  if (explicit !== undefined) {
    return explicit
  }
  const override = (key: string): boolean | undefined => {
    const value = env[key]
    if (value === undefined) {
      return undefined
    }
    const normalized = value.toLowerCase()
    if (normalized === "1" || normalized === "true") {
      return true
    }
    if (normalized === "0" || normalized === "false") {
      return false
    }
    // Unrecognized values fall through to the next resolution step.
    return undefined
  }
  const spiko = override("SPIKO_AGENT_MODE")
  if (spiko !== undefined) {
    return spiko
  }
  const force = override("FORCE_AGENT_MODE")
  if (force !== undefined) {
    return force
  }
  return detectAgentName(env) !== undefined
}

/**
 * Strip the agent-mode flags from raw argv before command parsing (the Effect
 * CLI grammar does not declare them) and report what was requested.
 *
 * Semantics:
 * - Each flag's own repetitions are last-wins (`--agent=false --agent=true`
 *   enables); `--no-agent` overrides `--agent` regardless of order, matching
 *   the documented "--no-agent has highest precedence" rule.
 * - Stripping stops at the `--` operand delimiter; later tokens are grammar,
 *   not flags.
 * - Assignments accept only true/1 and false/0. Anything else (e.g.
 *   `--agent=banana`) is left in argv so the grammar parser rejects it with
 *   its normal exit-2 invalid-input error instead of being silently dropped.
 */
export const extractAgentFlags = (
  args: ReadonlyArray<string>,
): { readonly args: Array<string>; readonly explicit: boolean | undefined } => {
  let agentFlag: boolean | undefined
  let noAgentFlag: boolean | undefined
  const remaining: Array<string> = []
  let operandOnly = false
  for (const arg of args) {
    if (!operandOnly && arg === "--") {
      operandOnly = true
      remaining.push(arg)
      continue
    }
    if (operandOnly) {
      remaining.push(arg)
      continue
    }
    const assignment = /^--(no-)?agent=(.+)$/.exec(arg)
    if (assignment !== null) {
      const value = assignment[2]?.toLowerCase() ?? ""
      if (value === "1" || value === "true" || value === "0" || value === "false") {
        const enabled = value === "1" || value === "true"
        if (assignment[1] === undefined) {
          agentFlag = enabled
        } else {
          noAgentFlag = enabled
        }
        continue
      }
      // Unrecognized value: leave it for the grammar parser to reject.
      remaining.push(arg)
      continue
    }
    if (arg === "--agent") {
      agentFlag = true
      continue
    }
    if (arg === "--no-agent") {
      noAgentFlag = true
      continue
    }
    remaining.push(arg)
  }
  if (noAgentFlag !== undefined) {
    return { args: remaining, explicit: !noAgentFlag }
  }
  return { args: remaining, explicit: agentFlag }
}
