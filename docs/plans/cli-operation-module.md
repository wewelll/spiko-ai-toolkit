# Rebuild the generated Spiko CLI

## Outcome

A human operator, agent, or automation harness can discover and invoke every committed Spiko Operation through one predictable shell interface. Help and the built-in wizard describe the actual accepted input; Effect Schema rejects invalid input locally; invocation uses statically typed client methods; success and failure produce stable JSON envelopes.

This is a greenfield replacement. The existing command grammar, output shape, runtime interpreter, and helper tests are not compatibility constraints.

## Context

Read before implementation:

- [`CONTEXT.md`](../../CONTEXT.md): Spiko Operation, Operation Definition, Operation Catalog.
- [`ADR-0001`](../adr/0001-generate-typed-cli-operation-definitions.md): accepted module, interface, seam, and adapter decisions.
- [`AGENTS.md`](../../AGENTS.md): authentication and client composition remain in owning client packages; MCP stdout remains protocol-only.

Load the repository's Effect skill before editing Effect workflows or tests. Effect 4 and its OpenAPI generator are beta; inspect the pinned source for unfamiliar interfaces instead of relying on memory.

## Accepted design

The deep CLI module exposes two internal entry points:

```ts
defineOperation({ confirmed, definition, parameters, prepare, invoke })
makeCli({ operationLayers, operations, version })
```

`defineOperation` receives serializable discovery data, typed Effect CLI parameters, a confirmation projection, a local preparation closure, and a statically typed invocation closure. It closes over the exact parsed input and returns a defined operation without losing its Effect errors or requirements. `makeCli` assembles resource/action commands, Operation Catalog discovery, JSON rendering, and process-level error handling. Operations and client layers are keyed by family; each layer is provided only around that family's invocation closure. Confirmation and local preparation therefore run before client acquisition, while list, describe, help, and input rejection acquire no clients or credentials.

Operation Definitions are generated under `apps/cli/src/generated/`. Routes are resolved during generation. Invocation closures use the existing Public, Investor, and Distributor context tags; production layers and focused test layers are the two adapters at the remote seam. Console, Terminal, Stdio, FileSystem, and Path use their existing Effect interfaces.

A throwaway compile prototype already proved that heterogeneous defined operations can retain their combined Effect requirements without casts.

## Shell interface

```sh
spiko call <family> <resource> <action> [flags]
spiko operations list <family>
spiko operations describe <family> <operation-id>
spiko --wizard
```

Rules:

- Every invocation has an explicit action; there are no default actions.
- Resource, action, and flag names use kebab-case.
- The exact OpenAPI `operationId` is the machine identity, even when it contains spaces.
- Same-named parameters become location-qualified only when needed, for example `--path-bank-account-id` and `--query-bank-account-id`.
- Array parameters use repeated flags.
- JSON request bodies use `--payload <file>`.
- Multipart fields use typed flags; binary values use file flags.
- Every method except `GET` and `HEAD` requires explicit `--confirm`.
- Wizard execution requires interactive stdin and stdout. Its final run prompt does not replace mutation confirmation.

## JSON and exit contract

Successful invocation writes one document to stdout:

```json
{
  "ok": true,
  "operation": "Get Fund",
  "data": {}
}
```

Failure writes one document to stderr:

```json
{
  "ok": false,
  "operation": "Get Fund",
  "error": {
    "code": "invalid-input",
    "message": "...",
    "details": []
  }
}
```

Exit status:

- `0`: success.
- `2`: invalid command or input, missing confirmation, or non-interactive wizard.
- `1`: configuration, remote, or internal failure.
- `130`: interactive wizard cancellation.

Help and wizard prompts remain terminal text. Runtime diagnostics never share stdout with the JSON success envelope.

## Non-goals

- Backward-compatible aliases, migration warnings, or dual dispatch.
- Changes to the MCP server.
- A human-oriented output renderer in this delivery.
- Inline JSON or field-by-field construction of JSON request bodies.
- Handwritten operation descriptions or schema overrides.
- Live credentialed requests in automated tests.
- Publishing or releasing packages as part of implementation.

## Work graph

```text
Slice 1: Public read tracer
    ↓
Slice 2: Complete Public catalog
    ↓
Slice 3: Investor JSON mutations
    ↓
Slice 4: Distributor multipart
    ↓
Slice 5: Complete catalog and delete interpreter
```

Use one coherent pull request per slice when practical. No slice adds a compatibility path. The branch is releasable only after Slice 5.

## Slice 1 — Public read tracer

### Bounded outcome

A caller can discover, inspect, and invoke the Public `Get Fund` operation through the new deep module without network access in tests.

```sh
spiko operations list public
spiko operations describe public "Get Fund"
spiko call public funds get --fund-id <uuid>
spiko call public funds get --help
```

### Implementation

- Add `apps/cli/src/cli.ts` with `defineOperation` and `makeCli`.
- Add a deterministic route-policy module used only during generation.
- Extend `tools/generate-clients.ts` through a focused generator module rather than adding more inline orchestration.
- Generate one Public Operation Definition containing:
  - exact OpenAPI identity and description;
  - explicit resource/action route;
  - serializable parameter and response metadata;
  - UUID-constrained `--fund-id` flag;
  - typed invocation closure using the Public client tag.
- Replace `program.ts` with thin composition around generated operations and the package version.
- Run commands with `Command.runWith(..., { renderErrors: false })` or the pinned equivalent so the CLI owns JSON error rendering and exit classification.
- Keep the existing runtime entry responsible only for Node layers and `runMain`.

### Acceptance evidence

- `operations list public` returns a success envelope with one concise item.
- `operations describe public "Get Fund"` returns a self-contained definition with JSON Schema using `$ref`/`$defs` where needed.
- Valid `fund-id` reaches a focused test Public adapter exactly once and returns a success envelope.
- Invalid UUID returns `invalid-input`, exits `2`, and records zero adapter calls.
- Help names the UUID input, requiredness, source description, method, and path.
- An interactive wizard can select and populate the operation using a test Terminal.
- A non-interactive wizard exits `2` before invocation.
- Typecheck proves the generated invocation closure calls the named client method with the expected input.

### Verification

```sh
pnpm --filter spiko-cli test
pnpm --filter spiko-cli typecheck
pnpm generate:check
```

### Stop conditions

- Stop if the generated definition needs `any`, an unchecked cast, or dynamic method lookup.
- Stop if public Effect CLI interfaces cannot preserve typed parameters and requirements; inspect pinned source and revise the interface before adding more operations.
- Stop if list and describe require network, credentials, or client acquisition.

## Slice 2 — Complete Public catalog

### Bounded outcome

All 15 Public Operations are generated, discoverable, locally validated, and invokable through explicit resource/action commands.

### Implementation

- Generalize Public generation without adding operation-specific handwritten branches.
- Generate string, enum, date-like, UUID, optional, and repeated parameter flags from OpenAPI schemas.
- Generate concise list data and full self-contained describe schemas.
- Fail generation on route collisions, unresolved path placeholders, duplicate flags, unsupported parameter shapes, or mismatched client methods.
- Keep JSON success/error rendering centralized in the deep module.

### Acceptance evidence

- Generated Public count is exactly `15`, with `15` unique OpenAPI operation IDs.
- Every generated route is unique and has an explicit action.
- Every definition has a matching statically named Public client invocation.
- Representative commands cover path-only, path-plus-query, optional query, enum, and date-like inputs.
- `operations list public` and representative `describe` documents satisfy stable JSON schemas.
- Regeneration is deterministic and leaves no diff.

### Verification

```sh
pnpm --filter spiko-cli test
pnpm --filter spiko-cli typecheck
pnpm generate:check
```

## Slice 3 — Investor JSON mutations

### Bounded outcome

All 35 Investor Operations work through the new module, including locally validated JSON mutations and explicit confirmation.

### Implementation

- Generate JSON body schemas and `--payload <file>` flags from OpenAPI request bodies.
- Read the payload file, parse JSON, and decode with Effect Schema before client acquisition.
- Generate confirmation safety from the HTTP method.
- Support repeated array parameters.
- Emit location-qualified flags for the existing path/query `bankAccountId` collision.
- Use the Investor client tag for statically typed invocation.

### Acceptance evidence

- Generated Investor count is exactly `35`, with `35` unique OpenAPI operation IDs.
- A valid account-creation payload reaches a focused Investor test adapter only when `--confirm` is present.
- Missing confirmation exits `2` before file read, client acquisition, or invocation.
- Invalid JSON and schema-invalid JSON exit `2` with stable error codes and zero adapter calls.
- The path/query collision exposes `--path-bank-account-id` and `--query-bank-account-id` as independent required inputs.
- Repeated array input reaches the generated client in source order.
- Help and wizard present body requiredness, request media type, and payload-file expectations.

### Verification

```sh
pnpm --filter spiko-cli test
pnpm --filter spiko-cli typecheck
pnpm generate:check
```

### Stop conditions

- Stop if a request-body schema cannot be represented as a self-contained JSON Schema plus Effect validation without weakening the committed OpenAPI definition.
- Stop if confirmation is enforced in more than one module; safety policy has one locality.

## Slice 4 — Distributor multipart

### Bounded outcome

A caller can upload an investor document with typed multipart fields and a file while all Distributor JSON bodies continue to use payload files.

```sh
spiko call distributor investor-documents upload \
  --investor-id <uuid> \
  --type official-id \
  --file ./identity.pdf \
  --confirm
```

### Implementation

- Generate a distinct multipart body definition from `multipart/form-data`.
- Generate typed scalar/enum form flags and file flags with source cardinality.
  File cardinality is enforced by the flag itself (`Flag.between(1, 1)`), so
  repeated file flags are rejected during parsing instead of silently resolved.
- Read selected files through Effect FileSystem after confirmation.
- Materialize the exact body expected by the generated Distributor client.
- Correct the generator template, the generated client emitter, or the owned
  deterministic post-generation corrections in `tools/fix-generated-client.ts`
  when emitted types and runtime behavior disagree; those corrections stay
  exact-match, fail on drift, and are re-applied by every regeneration. Never
  patch generated output by hand.
- Generate the remaining Distributor JSON operations through the established path.

### Acceptance evidence

- Multipart help lists accepted extensions, required fields, enum values, and file cardinality from OpenAPI.
- The wizard prompts for typed fields and a file, then still requires mutation confirmation.
- A test Distributor adapter receives the expected form values and file content exactly once.
- Missing, unreadable, or disallowed files fail locally with zero client acquisition or invocation.
- No multipart operation exposes `--payload`.
- JSON body operations still expose only `--payload <file>`.

### Verification

```sh
pnpm --filter spiko-cli test
pnpm --filter spiko-cli typecheck
pnpm generate:check
```

### Stop conditions

- Stop if multipart support requires a hand edit to a generated file.
- Stop if an unsupported media type would be silently treated as JSON or multipart; fail generation with the operation ID and source location.

## Slice 5 — Complete catalog and delete the interpreter

### Bounded outcome

The generated Operation Catalog covers every committed Spiko Operation, the old interpreter is gone, documentation reflects the new shell interface, and the workspace quality gate passes.

### Implementation

- Generate all Public, Investor, and Distributor definitions.
- Assert current source counts: Public `15`, Investor `35`, Distributor `65`.
- Add generator invariants for operation identity, route uniqueness, parameter bindings, body media types, schema availability, and static client method alignment.
- Delete:
  - `apps/cli/src/core.ts`;
  - runtime `apps/cli/src/routes.ts`;
  - dynamic client selection and method lookup;
  - the old metadata-only generated catalog;
  - tests that call `prepareInvocation` or runtime route helpers.
- Move authentication/client-composition tests into their owning packages if they still live under the CLI.
- Document the new grammar, discovery commands, JSON envelopes, exit statuses, payload files, multipart flags, and wizard requirements.
- Add the generated files to `generate:check` and a changeset for `spiko-cli`.

### Acceptance evidence

- Counts are exactly `15 / 35 / 65`; every operation has one unique definition and one statically checked invocation closure.
- `rg` finds no `prepareInvocation`, runtime `routeOperations`, `client[operationName]`, or `unknown[]` invocation path in the CLI.
- Command-interface tests cover success and error envelopes, every exit class, list/describe, help, interactive/non-interactive wizard behavior, confirmation, arrays, location collisions, JSON payloads, and multipart.
- `spiko operations list` and `describe` require no credentials and issue no network request.
- Generated files are deterministic and carry the generated-file marker.
- The repository contains no compatibility alias or dual dispatch.

### Verification

```sh
pnpm check
```

## Critical failure responses

- **Generated output drifts:** stop, correct deterministic generation, regenerate, and rerun `pnpm generate:check`.
- **Static invocation does not typecheck:** stop at the affected Operation Definition; do not add dynamic lookup or unchecked casts.
- **OpenAPI shape is unsupported:** fail generation with operation ID, method, path, and unsupported shape; resolve the design before continuing.
- **Command test reaches network:** replace the client layer at the existing tag seam and rerun the affected command test.
- **Sensitive configuration appears in JSON errors:** sanitize at the owning error-rendering locality, add a regression test, and rerun all error-envelope checks.
- **Wizard bypasses confirmation:** block the slice; confirmation and the final run prompt are independent required actions.
- **Diagnostics reach stdout:** block the slice; stdout is reserved for the success JSON envelope.

## Definition of done

The outcome is complete when all 115 committed Spiko Operations are generated and statically aligned, every agreed shell behavior is observed through command-interface tests, `pnpm check` passes, generated output is deterministic, old shallow modules and dynamic invocation are deleted, domain language and ADR remain accurate, and no unapproved release action has occurred.
