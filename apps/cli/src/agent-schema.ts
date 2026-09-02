import type { OperationDefinition, SpikoFamily } from "./cli.ts"

/**
 * Machine-readable discovery output for AI agents.
 *
 * The schema is derived from the same OperationDefinitions that build the
 * command tree, so it cannot drift from the implemented grammar. Response
 * JSON Schemas stay out of the schema (they remain available per operation
 * through `spiko operations describe`), keeping one-shot discovery cheap.
 */

const spikoFamilies: ReadonlyArray<SpikoFamily> = ["public", "investor", "distributor"]

export interface AgentSchemaFlag {
  readonly description?: string
  readonly flag: string
  readonly file?: boolean
  readonly in?: "cookie" | "header" | "path" | "query" | "body"
  readonly name?: string
  readonly required: boolean
}

export interface AgentSchemaAction {
  readonly action: string
  readonly command: string
  readonly description?: string
  readonly flags?: ReadonlyArray<AgentSchemaFlag>
  readonly method?: string
  readonly operationId?: string
  readonly path?: string
  readonly safety?: "mutation" | "read"
}

export interface CompactAction {
  /** Bare flag names, e.g. "--fund-id". */
  readonly flags: ReadonlyArray<string>
  readonly command: string
}

export interface AgentSchemaResource {
  readonly actions: ReadonlyArray<AgentSchemaAction | CompactAction>
  readonly resource: string
}

export interface AgentSchemaFamily {
  readonly family: SpikoFamily
  readonly resources: ReadonlyArray<AgentSchemaResource>
}

export const summarizeDefinition = (definition: OperationDefinition): Record<string, unknown> => ({
  action: definition.action,
  command: `spiko call ${definition.family} ${definition.resource} ${definition.action}`,
  description: definition.description,
  family: definition.family,
  flags: operationFlags(definition),
  method: definition.method,
  operationId: definition.operationId,
  // Request/response JSON Schemas are omitted; agents that need exact payload
  // shapes can run `operations describe` for this operationId.
  requestBody:
    definition.requestBody === null
      ? null
      : {
          fields: definition.requestBody.fields.map((field) => ({
            file: field.file,
            flag: field.flag,
            name: field.name,
            required: field.required,
          })),
          kind: definition.requestBody.kind,
          mediaType: definition.requestBody.mediaType,
          required: definition.requestBody.required,
        },
  responses: definition.responses.map((response) => ({
    description: response.description,
    status: response.status,
  })),
  safety: definition.safety,
})

/** Schema-tree action entry carrying descriptions and full flag metadata. */
const fullAction = (definition: OperationDefinition): AgentSchemaAction => ({
  action: definition.action,
  command: `spiko call ${definition.family} ${definition.resource} ${definition.action}`,
  description: definition.description,
  flags: operationFlags(definition),
  method: definition.method,
  operationId: definition.operationId,
  path: definition.path,
  safety: definition.safety,
})

const mutationConfirmFlag: AgentSchemaFlag = {
  description: "Confirm this mutating Spiko Operation",
  flag: "--confirm",
  required: true,
}

const operationFlags = (definition: OperationDefinition): ReadonlyArray<AgentSchemaFlag> => {
  const parameterFlags: ReadonlyArray<AgentSchemaFlag> = definition.parameters.map((parameter) => ({
    description: parameter.description,
    flag: `--${parameter.flag}`,
    in: parameter.in,
    name: parameter.name,
    required: parameter.required,
  }))
  // The generator models JSON request bodies as a single validated
  // `--payload <file>` flag rather than per-field flags, and every mutating
  // operation requires --confirm regardless of whether it carries a body.
  const bodyFlags: ReadonlyArray<AgentSchemaFlag> =
    definition.requestBody === null
      ? definition.safety === "mutation"
        ? [mutationConfirmFlag]
        : []
      : [
          ...(definition.requestBody.kind === "json"
            ? [
                {
                  description: "Path to a JSON file validated against the OpenAPI request schema",
                  flag: "--payload",
                  in: "body" as const,
                  required: definition.requestBody.required,
                },
              ]
            : definition.requestBody.fields.map((field): AgentSchemaFlag => ({
                ...(field.file ? { file: true } : {}),
                flag: `--${field.flag}`,
                in: "body",
                name: field.name,
                required: field.required,
              }))),
          ...(definition.safety === "mutation" ? [mutationConfirmFlag] : []),
        ]
  return [...parameterFlags, ...bodyFlags]
}

// Compact mode keeps one-shot discovery cheap: command paths plus bare flag
// names only. Requiredness and descriptions stay available through scoped
// help or `operations describe`.
const compactAction = (definition: OperationDefinition): CompactAction => ({
  command: `spiko call ${definition.family} ${definition.resource} ${definition.action}`,
  flags: operationFlags(definition).map((flag) => flag.flag),
})

const buildCommands = (
  definitions: ReadonlyArray<OperationDefinition>,
  options: { readonly compact: boolean },
): ReadonlyArray<AgentSchemaFamily> =>
  spikoFamilies
    .map((family) => {
      const resources = Array.from(
        new Set(
          definitions
            .filter((definition) => definition.family === family)
            .map((definition) => definition.resource),
        ),
      ).map((resource) => {
        const familyResources = definitions.filter(
          (definition) => definition.family === family && definition.resource === resource,
        )
        return options.compact
          ? { actions: familyResources.map(compactAction), resource }
          : { actions: familyResources.map(fullAction), resource }
      })
      return { family, resources }
    })
    .filter((family) => family.resources.length > 0)

/**
 * Filter the command tree to a subtree scope, e.g. ["call", "public",
 * "funds", "get"] keeps only that family, resource, and action. Non-call
 * scopes return all commands. Returns undefined when nothing matches.
 */
const scopeCommands = (
  families: ReadonlyArray<AgentSchemaFamily>,
  path: ReadonlyArray<string>,
): ReadonlyArray<AgentSchemaFamily> | undefined => {
  if (path[0] !== "call") {
    return families
  }
  const [, familyName, resourceName, actionName] = path
  const actionNameOf = (action: AgentSchemaAction | CompactAction): string | undefined =>
    "action" in action ? action.action : action.command.split(" ").at(-1)
  const scopedFamilies = families
    .filter((family) => familyName === undefined || family.family === familyName)
    .map((family) => ({
      family: family.family,
      resources: family.resources
        .filter((resource) => resourceName === undefined || resource.resource === resourceName)
        .map((resource) => ({
          actions: resource.actions.filter(
            (action) => actionName === undefined || actionNameOf(action) === actionName,
          ),
          resource: resource.resource,
        })),
    }))
    .map((family) => ({
      family: family.family,
      resources: family.resources.filter((resource) => resource.actions.length > 0),
    }))
    .filter((family) => family.resources.length > 0)
  return scopedFamilies.length > 0 ? scopedFamilies : undefined
}

const scriptAuthoringGuidance = {
  detection:
    "Agent mode is on when any of: --agent flag, SPIKO_AGENT_MODE=1 or FORCE_AGENT_MODE=1, or an agent environment variable (CLAUDECODE, CURSOR_AGENT, CODEX, PI_CODING_AGENT, AGENT, ...) is set.",
  examples: [
    "# Agent runs interactively (envelope wrapped):",
    "spiko call public funds list",
    "",
    "# Agent writes a script for the user (raw output, parity with their shell):",
    "spiko --no-agent call public funds list | jq '.[].slug'",
  ],
  rule: "When authoring a script, alias, or any spiko command that the user (or CI) will run outside this agent session, append --no-agent so the output format matches what they will see.",
  summary:
    "Agent mode wraps successful responses in a {data, ok, operation, metadata} envelope. Outside agent mode, spiko emits the raw payload only.",
}

export interface BuildAgentSchemaOptions {
  readonly compact?: boolean
  /** Command path to scope the schema to, e.g. ["call", "public"]. */
  readonly path?: ReadonlyArray<string>
  readonly version: string
}

/** Structured entries for the non-call discovery commands. */
const discoveryCommands = [
  {
    args: ["<family>"],
    command: "spiko operations list",
    description: "List the generated Spiko Operations of one family",
  },
  {
    args: ["<family>", "<operation-id>"],
    command: "spiko operations describe",
    description: "Describe one generated Operation; pass --summary to omit JSON Schemas",
    flags: [{ flag: "--summary", required: false }],
  },
  {
    args: [],
    command: "spiko agent schema",
    description: "Emit this machine-readable schema",
    flags: [{ flag: "--compact", required: false }],
  },
]

export const buildAgentSchema = (
  definitions: ReadonlyArray<OperationDefinition>,
  options: BuildAgentSchemaOptions,
): Record<string, unknown> => {
  const compact = options.compact ?? false
  const allCommands = buildCommands(definitions, { compact })
  // Only call paths narrow the tree; any other help scope (operations,
  // operations list, ...) describes the whole catalog and must not claim a
  // narrower scope than it renders.
  const isCallScope = (options.path?.[0] ?? "call") === "call"
  const commands =
    !isCallScope || options.path === undefined
      ? allCommands
      : scopeCommands(allCommands, options.path)
  const schema: Record<string, unknown> = {
    agent_mode: {
      env_overrides: ["SPIKO_AGENT_MODE", "FORCE_AGENT_MODE"],
      flags: {
        "--agent": "Force agent mode on",
        "--no-agent": "Force agent mode off (use when authoring scripts for humans or CI)",
      },
    },
    authentication: {
      distributor: "SPIKO_DISTRIBUTOR_CLIENT_ID + SPIKO_DISTRIBUTOR_CLIENT_SECRET",
      investor:
        "SPIKO_INVESTOR_ACCESS_TOKEN, or SPIKO_INVESTOR_CLIENT_ID + SPIKO_INVESTOR_CLIENT_SECRET",
      public: "No credentials required",
    },
    best_practices: [
      "Run 'spiko operations list <family>' first; never guess resource or action names",
      "Use 'spiko operations describe <family> \"<operation-id>\"' for exact flags, enum values, and payload schemas before invoking an operation",
      "Pass JSON request bodies as files via --payload; bodies are validated against the OpenAPI schema before sending",
      "Every mutating operation requires --confirm; there is no interactive confirmation prompt",
      "Parse stdout as JSON; failures are written to stderr with exit status 1 or 2",
      "Public operations need no credentials; configure investor/distributor auth through SPIKO_* environment variables before calling those families",
    ],
    commands: commands ?? [],
    anti_patterns: [
      "Don't guess command grammar; resources and actions come from the generated catalog",
      "Don't send mutations without --confirm; they fail locally with invalid-input before any request",
      "Don't use the wizard for automation; it requires an interactive terminal",
      "Don't parse human help text; use 'spiko agent schema' for structured discovery",
      "Don't author scripts for users without --no-agent; the envelope only appears in agent mode (see script_authoring)",
    ],
    description:
      "Spiko CLI — discover and invoke Operations from the committed Spiko Public, Investor, and Distributor OpenAPI documents.",
    discovery_commands: discoveryCommands,
    script_authoring: scriptAuthoringGuidance,
    usage: [
      "spiko operations list <family>",
      "spiko operations describe <family> <operation-id> [--summary]",
      "spiko call <family> <resource> <action> [flags]",
      "spiko agent schema [--compact]",
    ],
    version: options.version,
    workflows: [
      {
        name: "Discover then invoke",
        steps: [
          "spiko operations list public",
          'spiko operations describe public "Get Fund"',
          "spiko call public funds get --fund-id <uuid>",
        ],
      },
      {
        name: "Mutate safely",
        steps: [
          'spiko operations describe investor "accounts.createAccount"',
          "# Write the validated JSON body to a file, then:",
          "spiko call investor accounts create --payload ./account.json --confirm",
        ],
      },
    ],
  }
  if (options.path !== undefined && isCallScope && commands !== allCommands) {
    schema["scope"] = options.path.join(" ")
  }
  return schema
}
