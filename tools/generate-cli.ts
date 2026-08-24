import { camelize } from "@effect/openapi-generator/Utils"
import { Predicate } from "effect"
import * as String from "effect/String"
import type {
  OpenAPISpec,
  OpenAPISpecMethodName,
  OpenAPISpecOperation,
  OpenAPISpecParameter,
} from "effect/unstable/httpapi/OpenApi"
import { routeOperations } from "./cli-routes.ts"

export interface CliSourceDocument {
  readonly document: OpenAPISpec
  readonly family: "distributor" | "investor" | "public"
}

export interface GeneratedCliFile {
  readonly content: string
  readonly path: string
}

interface SourceOperation {
  readonly method: OpenAPISpecMethodName
  readonly operation: OpenAPISpecOperation
  readonly path: string
}

interface ParameterBinding {
  readonly configKey: string
  readonly flag: string
  readonly parameter: OpenAPISpecParameter
  readonly schema: object
}

const methods: ReadonlyArray<OpenAPISpecMethodName> = [
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]

const operationDescription = (operation: OpenAPISpecOperation): string =>
  operation.description ?? operation.summary ?? operation.operationId

const resourceName = (operation: OpenAPISpecOperation): string =>
  String.kebabCase(operation.tags[0].replace(/\s*\([^)]*\)\s*/g, " "))

const collectOperations = (document: OpenAPISpec): ReadonlyArray<SourceOperation> => {
  const operations: Array<SourceOperation> = []
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of methods) {
      const operation = item[method]
      if (operation !== undefined) {
        operations.push({ method, operation, path })
      }
    }
  }
  return operations
}

const property = (value: object, key: string): unknown =>
  Predicate.hasProperty(value, key) ? value[key] : undefined

const stringProperty = (value: object, key: string): string | undefined => {
  const candidate = property(value, key)
  return Predicate.isString(candidate) ? candidate : undefined
}

const schemaDescription = (schema: object): string | undefined =>
  stringProperty(schema, "description")

const schemaLabel = (schema: object): string | undefined =>
  schemaDescription(schema) ?? stringProperty(schema, "title")

const referenceName = (schema: object): string | undefined => {
  const reference = stringProperty(schema, "$ref")
  if (reference === undefined) {
    return undefined
  }
  const prefix = "#/components/schemas/"
  if (!reference.startsWith(prefix) || reference.length === prefix.length) {
    throw new Error(`Unsupported OpenAPI schema reference: ${reference}`)
  }
  return reference.slice(prefix.length)
}

const componentSchema = (document: OpenAPISpec, name: string): object => {
  const schema = document.components.schemas[name]
  if (!Predicate.isObject(schema)) {
    throw new Error(`OpenAPI component schema "${name}" was not found or is not an object`)
  }
  return schema
}

const resolveRootSchema = (document: OpenAPISpec, schema: object): object => {
  const name = referenceName(schema)
  return name === undefined ? schema : resolveRootSchema(document, componentSchema(document, name))
}

const bundleSchema = (document: OpenAPISpec, schema: object): object => {
  const definitions = new Map<string, unknown>()

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(visit)
    }
    if (!Predicate.isObject(value)) {
      return value
    }

    const name = referenceName(value)
    const entries = Object.entries(value).filter(([key]) => key !== "$ref")
    const normalized = Object.fromEntries(entries.map(([key, child]) => [key, visit(child)]))
    if (name === undefined) {
      return normalized
    }

    if (!definitions.has(name)) {
      definitions.set(name, {})
      definitions.set(name, visit(componentSchema(document, name)))
    }
    return { $ref: `#/$defs/${name}`, ...normalized }
  }

  const root = visit(schema)
  if (!Predicate.isObject(root)) {
    throw new Error("OpenAPI schema must normalize to an object")
  }
  return definitions.size === 0 ? root : { ...root, $defs: Object.fromEntries(definitions) }
}

const renderResponses = (document: OpenAPISpec, operation: OpenAPISpecOperation) =>
  Object.entries(operation.responses).map(([status, response]) => ({
    content:
      response.content === undefined
        ? []
        : Object.entries(response.content).map(([mediaType, media]) => ({
            mediaType,
            schema: bundleSchema(document, media.schema),
          })),
    description: response.description,
    status,
  }))

const pathPlaceholders = (path: string): ReadonlyArray<string> =>
  Array.from(path.matchAll(/\{([^}]+)\}/g), (match) => match[1]).filter(Predicate.isString)

const validateParameterBindings = (
  source: SourceOperation,
): ReadonlyArray<OpenAPISpecParameter> => {
  const { operation, path } = source
  const placeholders = pathPlaceholders(path)
  const pathParameters = operation.parameters.filter((parameter) => parameter.in === "path")
  const placeholderCounts = Map.groupBy(placeholders, (name) => name)

  for (const [name, occurrences] of placeholderCounts) {
    if (occurrences.length !== 1) {
      throw new Error(`${operation.operationId}: path placeholder "${name}" appears more than once`)
    }
  }
  for (const name of placeholders) {
    const matches = pathParameters.filter((parameter) => parameter.name === name)
    if (matches.length !== 1 || !matches[0]?.required) {
      throw new Error(
        `${operation.operationId}: path placeholder "${name}" must have one required path parameter`,
      )
    }
  }
  for (const parameter of pathParameters) {
    if (!placeholders.includes(parameter.name)) {
      throw new Error(
        `${operation.operationId}: path parameter "${parameter.name}" has no placeholder in ${path}`,
      )
    }
  }
  for (const parameter of operation.parameters) {
    if (parameter.in !== "path" && parameter.in !== "query") {
      throw new Error(
        `${operation.operationId}: unsupported ${parameter.in} parameter "${parameter.name}"`,
      )
    }
  }

  return operation.parameters
}

const parameterBindings = (
  document: OpenAPISpec,
  source: SourceOperation,
): ReadonlyArray<ParameterBinding> => {
  const parameters = validateParameterBindings(source)
  const names = Map.groupBy(parameters, (parameter) => String.kebabCase(parameter.name))
  const bindings = parameters.map((parameter) => {
    const baseFlag = String.kebabCase(parameter.name)
    const flag =
      names.get(baseFlag)?.length === 1 ? baseFlag : `${String.kebabCase(parameter.in)}-${baseFlag}`
    return {
      configKey: camelize(flag),
      flag,
      parameter,
      schema: resolveRootSchema(document, parameter.schema),
    }
  })
  const duplicateFlags = Array.from(
    Map.groupBy(bindings, (binding) => binding.flag),
    ([flag, matches]) => ({ flag, matches }),
  ).filter(({ matches }) => matches.length > 1)
  if (duplicateFlags.length > 0) {
    throw new Error(
      `${source.operation.operationId}: duplicate CLI flag(s): ${duplicateFlags.map(({ flag }) => flag).join(", ")}`,
    )
  }
  return bindings
}

const enumValues = (schema: object): ReadonlyArray<string> | undefined => {
  const values = property(schema, "enum")
  return Array.isArray(values) && values.length > 0 && values.every(Predicate.isString)
    ? values
    : undefined
}

const dayLike = (parameter: OpenAPISpecParameter, schema: object): boolean => {
  const title = stringProperty(schema, "title")?.toLowerCase()
  const description = schemaDescription(schema)?.toLowerCase()
  const name = parameter.name.toLowerCase()
  return (
    title === "day" ||
    name === "day" ||
    name.endsWith("day") ||
    name.endsWith("date") ||
    description?.includes("yyyy-mm-dd") === true
  )
}

const renderScalarFlag = (binding: ParameterBinding): string => {
  const { flag, parameter, schema } = binding
  const values = enumValues(schema)
  if (values !== undefined) {
    return `Flag.choice(${JSON.stringify(flag)}, ${JSON.stringify(values)})`
  }

  if (stringProperty(schema, "type") !== "string") {
    throw new Error(`${parameter.name}: unsupported parameter schema ${JSON.stringify(schema)}`)
  }
  if (stringProperty(schema, "format") === "uuid") {
    return `Flag.string(${JSON.stringify(flag)}).pipe(\n      Flag.withSchema(Schema.String.check(Schema.isUUID())),\n      Flag.withMetavar("UUID"),\n    )`
  }
  if (dayLike(parameter, schema)) {
    return `Flag.string(${JSON.stringify(flag)}).pipe(\n      Flag.withSchema(Schema.String.check(Schema.isPattern(/^\\d{4}-\\d{2}-\\d{2}$/))),\n      Flag.withMetavar("YYYY-MM-DD"),\n    )`
  }
  return `Flag.string(${JSON.stringify(flag)})`
}

const renderFlag = (binding: ParameterBinding): string => {
  const { parameter, schema } = binding
  const type = stringProperty(schema, "type")
  const isArray = type === "array"
  let rendered: string
  if (isArray) {
    const items = property(schema, "items")
    if (!Predicate.isObject(items)) {
      throw new Error(`${parameter.name}: array parameter must declare an item schema`)
    }
    rendered = renderScalarFlag({ ...binding, schema: items })
  } else {
    rendered = renderScalarFlag(binding)
  }

  const requiredness = parameter.required ? "Required" : "Optional"
  const sourceDescription = `${requiredness} ${parameter.in} parameter: ${parameter.name} — ${
    parameter.description ?? schemaLabel(schema) ?? parameter.name
  }`
  const transforms = [
    `Flag.withDescription(${JSON.stringify(sourceDescription)})`,
    ...(isArray ? ["Flag.atLeast(1)"] : []),
    ...(!parameter.required ? ["Flag.optional"] : []),
  ]

  return `${rendered}.pipe(\n      ${transforms.join(",\n      ")},\n    )`
}

const optionalInput = (binding: ParameterBinding): string =>
  `input[${JSON.stringify(binding.configKey)}]`

const renderParamsObject = (bindings: ReadonlyArray<ParameterBinding>): string => {
  const fields = bindings.map((binding) => {
    const name = JSON.stringify(binding.parameter.name)
    const input = optionalInput(binding)
    return binding.parameter.required
      ? `${name}: ${input}`
      : `...(Option.isSome(${input}) ? { ${name}: ${input}.value } : {})`
  })
  return `{ ${fields.join(", ")} }`
}

const renderInvocation = (
  source: SourceOperation,
  bindings: ReadonlyArray<ParameterBinding>,
): string => {
  const methodName = camelize(source.operation.operationId)
  const paths = bindings.filter((binding) => binding.parameter.in === "path").map(optionalInput)
  const queries = bindings.filter((binding) => binding.parameter.in === "query")
  const options = queries.length === 0 ? "undefined" : `{ params: ${renderParamsObject(queries)} }`
  return `input => Effect.flatMap(PublicApi, (client) => client.${methodName}(${[
    ...paths,
    options,
  ].join(", ")}))`
}

const renderPublicOperation = (
  document: OpenAPISpec,
  source: SourceOperation,
  route: { readonly action: string; readonly resource: string },
): { readonly exportName: string; readonly source: string } => {
  const { method, operation, path } = source
  if (operation.requestBody !== undefined) {
    throw new Error(`${operation.operationId}: Public Operations must not declare request bodies`)
  }
  const bindings = parameterBindings(document, source)
  const definition = {
    action: route.action,
    description: operationDescription(operation),
    family: "public",
    method: method.toUpperCase(),
    operationId: operation.operationId,
    parameters: bindings.map(({ flag, parameter }) => ({
      description:
        parameter.description ??
        schemaLabel(resolveRootSchema(document, parameter.schema)) ??
        parameter.name,
      flag,
      in: parameter.in,
      name: parameter.name,
      required: parameter.required,
      schema: bundleSchema(document, parameter.schema),
    })),
    path,
    requestBody: null,
    resource: route.resource,
    responses: renderResponses(document, operation),
    safety: "read",
  }
  const exportName = camelize(operation.operationId)
  const definitionSource = JSON.stringify(definition)
  const parameters = bindings
    .map(
      (binding) =>
        `    ${JSON.stringify(binding.configKey)}: ${renderFlag(binding).replaceAll("\n", "\n    ")},`,
    )
    .join("\n")

  return {
    exportName,
    source: `export const ${exportName} = defineOperation({
  definition: ${definitionSource},
  parameters: {
${parameters}
  },
  invoke: ${renderInvocation(source, bindings)},
})`,
  }
}

const renderPublic = (document: OpenAPISpec): string => {
  const operations = collectOperations(document)
  if (operations.length !== 15) {
    throw new Error(
      `The Public OpenAPI document must contain 15 Operations; found ${operations.length}`,
    )
  }
  const operationIds = Map.groupBy(operations, ({ operation }) => operation.operationId)
  const duplicateIds = Array.from(operationIds, ([id, matches]) => ({ id, matches })).filter(
    ({ matches }) => matches.length > 1,
  )
  if (duplicateIds.length > 0) {
    throw new Error(
      `Duplicate Public operationId(s): ${duplicateIds.map(({ id }) => id).join(", ")}`,
    )
  }

  const routes = routeOperations(
    operations.map(({ method, operation, path }) => ({
      method: method.toUpperCase(),
      operationId: operation.operationId,
      path,
      resource: resourceName(operation),
    })),
  )
  const rendered = operations.map((source, index) => {
    const route = routes[index]
    if (route === undefined) {
      throw new Error(`Missing generated CLI route for ${source.operation.operationId}`)
    }
    return renderPublicOperation(document, source, route)
  })
  return `// This file is generated by tools/generate-clients.ts. Do not edit it by hand.

import { PublicApi } from "@spiko/public-api-client"
import { Effect, Option, Schema } from "effect"
import { Flag } from "effect/unstable/cli"
import { defineOperation } from "../cli.ts"

${rendered.map(({ source }) => source).join("\n\n")}

export const PublicOperations = [
${rendered.map(({ exportName }) => `  ${exportName},`).join("\n")}
] as const
`
}

export const generateCliFiles = (
  documents: ReadonlyArray<CliSourceDocument>,
): ReadonlyArray<GeneratedCliFile> => {
  const publicDocument = documents.find((source) => source.family === "public")
  if (publicDocument === undefined) {
    throw new Error("The Public OpenAPI document is required to generate the CLI")
  }

  return [
    {
      content: renderPublic(publicDocument.document),
      path: "apps/cli/src/generated/public.ts",
    },
  ]
}
