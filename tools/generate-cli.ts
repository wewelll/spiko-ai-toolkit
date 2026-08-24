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
  readonly clientMethods: ReadonlySet<string>
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

// `export const ${name}` and client method selection require camelize(operationId)
// to be a valid, non-reserved identifier; the pinned camelize drops leading digits
// ("123" becomes empty) and passes reserved words through, so drift must fail
// generation instead of emitting invalid TypeScript.
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const reservedWords = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for function if import in instanceof new null return super switch this throw " +
    "true try typeof var void while with yield let static await implements interface package " +
    "private protected public arguments eval"
  ).split(" "),
)

const operationDescription = (operation: OpenAPISpecOperation): string =>
  operation.description ?? operation.summary ?? operation.operationId

// Resource names come from the primary OpenAPI tag. Spiko's tags may carry a
// parenthetical qualifier such as "Investor Documents (v0)"; strip it before
// kebab-casing so the qualifier never leaks into command grammar.
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

const numberProperty = (value: object, key: string): number | undefined => {
  const candidate = property(value, key)
  return Predicate.isNumber(candidate) ? candidate : undefined
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

    // Register the name before visiting so recursive component schemas terminate;
    // the placeholder entry is replaced once the visited subtree completes.
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
      throw new Error(`Path placeholder "${name}" appears more than once`)
    }
  }
  for (const name of placeholders) {
    const matches = pathParameters.filter((parameter) => parameter.name === name)
    if (matches.length !== 1 || !matches[0]?.required) {
      throw new Error(`Path placeholder "${name}" must have one required path parameter`)
    }
  }
  for (const parameter of pathParameters) {
    if (!placeholders.includes(parameter.name)) {
      throw new Error(`Path parameter "${parameter.name}" has no placeholder`)
    }
  }
  // Client methods receive path parameters positionally in template order, so the
  // parameters array must list path parameters in that same order.
  const parameterOrder = pathParameters.map((parameter) => parameter.name)
  if (parameterOrder.some((name, index) => name !== placeholders[index])) {
    throw new Error(
      `Path parameters [${parameterOrder.join(", ")}] do not follow template order [${placeholders.join(", ")}]`,
    )
  }
  for (const parameter of operation.parameters) {
    if (parameter.in !== "path" && parameter.in !== "query") {
      throw new Error(`Unsupported ${parameter.in} parameter "${parameter.name}"`)
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
    throw new Error(`Duplicate CLI flag(s): ${duplicateFlags.map(({ flag }) => flag).join(", ")}`)
  }
  return bindings
}

const enumValues = (schema: object): ReadonlyArray<string> | undefined => {
  const values = property(schema, "enum")
  return Array.isArray(values) && values.length > 0 && values.every(Predicate.isString)
    ? values
    : undefined
}

// A day-like parameter is recognized only from schema-backed evidence in the
// committed OpenAPI document: a "Day" schema title or a yyyy-mm-dd description.
// Parameter names are deliberately not consulted so free-text fields are never
// silently constrained to date syntax.
const dayLike = (schema: object): boolean => {
  const title = stringProperty(schema, "title")?.toLowerCase()
  const description = schemaDescription(schema)?.toLowerCase()
  return title === "day" || description?.includes("yyyy-mm-dd") === true
}

// Committed string constraints become local Schema checks; any unrecognized
// constraint fails generation so a new spec constraint is never silently
// dropped from local validation.
const stringSchemaChecks = (
  parameter: OpenAPISpecParameter,
  schema: object,
): ReadonlyArray<string> => {
  const format = stringProperty(schema, "format")
  if (format !== undefined && format !== "uuid") {
    throw new Error(`${parameter.name}: unsupported parameter format "${format}"`)
  }
  const unsupportedConstraints = [
    "maxLength",
    "pattern",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
  ].filter((constraint) => property(schema, constraint) !== undefined)
  if (unsupportedConstraints.length > 0) {
    throw new Error(
      `${parameter.name}: unsupported parameter constraint(s): ${unsupportedConstraints.join(", ")}`,
    )
  }
  const minLength = numberProperty(schema, "minLength")
  if (minLength !== undefined && (!Number.isInteger(minLength) || minLength < 0)) {
    throw new Error(
      `${parameter.name}: unsupported parameter minLength ${JSON.stringify(minLength)}`,
    )
  }
  return [
    ...(format === "uuid" ? ["Schema.isUUID()"] : []),
    ...(dayLike(schema) ? ["Schema.isPattern(/^\\d{4}-\\d{2}-\\d{2}$/)"] : []),
    ...(minLength !== undefined && minLength > 0 ? [`Schema.isMinLength(${minLength})`] : []),
  ]
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
  const checks = stringSchemaChecks(parameter, schema)
  if (checks.length === 0) {
    return `Flag.string(${JSON.stringify(flag)})`
  }
  const metavar =
    stringProperty(schema, "format") === "uuid"
      ? "UUID"
      : dayLike(schema)
        ? "YYYY-MM-DD"
        : undefined
  return `Flag.string(${JSON.stringify(flag)}).pipe(\n      Flag.withSchema(Schema.String.check(${checks.join(", ")})),${
    metavar === undefined ? "" : `\n      Flag.withMetavar(${JSON.stringify(metavar)}),`
  }\n    )`
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
  clientTag: string,
  bodyExpression: string | undefined,
): string => {
  const methodName = camelize(source.operation.operationId)
  const paths = bindings.filter((binding) => binding.parameter.in === "path").map(optionalInput)
  const queries = bindings.filter((binding) => binding.parameter.in === "query")
  const optionFields = [
    ...(queries.length === 0 ? [] : [`params: ${renderParamsObject(queries)}`]),
    ...(bodyExpression === undefined ? [] : [`payload: ${bodyExpression}`]),
  ]
  const options = optionFields.length === 0 ? "undefined" : `{ ${optionFields.join(", ")} }`
  return `input => Effect.flatMap(${clientTag}, (client) => client.${methodName}(${[
    ...paths,
    options,
  ].join(", ")}))`
}

interface FamilyGeneration {
  readonly clientMethods: ReadonlySet<string>
  readonly clientModule: string
  readonly clientTag: string
  readonly count: number
  readonly family: CliSourceDocument["family"]
}

interface JsonRequestBodyBinding {
  readonly kind: "json"
  readonly mediaType: "application/json"
  readonly schema: object
  readonly schemaName: string
}

interface MultipartFieldBinding {
  readonly acceptedExtensions: ReadonlyArray<string>
  readonly configKey: string
  readonly file: boolean
  readonly flag: string
  readonly name: string
  readonly required: boolean
  readonly schema: object
}

interface MultipartRequestBodyBinding {
  readonly fields: ReadonlyArray<MultipartFieldBinding>
  // The single file field from `fields`; requestBodyBinding enforces exactly one.
  readonly file: MultipartFieldBinding
  readonly kind: "multipart"
  readonly mediaType: "multipart/form-data"
  readonly schema: object
}

type RequestBodyBinding = JsonRequestBodyBinding | MultipartRequestBodyBinding

// Binary multipart fields are unusable without allowed extensions, and Spiko
// declares them only in prose: the operation description sentence "Supported
// extensions are: ...". Fail generation when that sentence is missing instead of
// silently accepting every file.
const supportedExtensions = (source: SourceOperation): ReadonlyArray<string> => {
  const description = source.operation.description ?? ""
  const match = /supported extensions are:\s*([^.]+)\./i.exec(description)
  const extensions = match?.[1]
    ?.split(",")
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.length > 0)
  if (extensions === undefined || extensions.length === 0) {
    throw new Error(
      `${source.operation.operationId} ${source.method.toUpperCase()} ${source.path}: binary multipart fields require supported extensions in the OpenAPI description`,
    )
  }
  return extensions
}

const multipartFields = (
  document: OpenAPISpec,
  source: SourceOperation,
  schema: object,
): ReadonlyArray<MultipartFieldBinding> => {
  const resolved = resolveRootSchema(document, schema)
  const properties = property(resolved, "properties")
  const requiredValue = property(resolved, "required")
  const required = Array.isArray(requiredValue) ? requiredValue.filter(Predicate.isString) : []
  if (stringProperty(resolved, "type") !== "object" || !Predicate.isObject(properties)) {
    throw new Error("Multipart request body must be an object")
  }

  return Object.entries(properties).map(([name, fieldSchema]) => {
    if (!Predicate.isObject(fieldSchema)) {
      throw new Error(`Multipart field ${name} has no schema`)
    }
    const resolvedField = resolveRootSchema(document, fieldSchema)
    const items = property(resolvedField, "items")
    const resolvedItems = Predicate.isObject(items) ? resolveRootSchema(document, items) : undefined
    const file =
      stringProperty(resolvedField, "type") === "array" &&
      resolvedItems !== undefined &&
      stringProperty(resolvedItems, "format") === "binary"
    if (file) {
      if (property(resolvedField, "minItems") !== 1 || property(resolvedField, "maxItems") !== 1) {
        throw new Error(`Multipart file field ${name} must require exactly one file`)
      }
    } else if (stringProperty(resolvedField, "type") !== "string") {
      throw new Error(`Unsupported multipart field ${name}: ${JSON.stringify(resolvedField)}`)
    }
    const flag = String.kebabCase(name)
    return {
      acceptedExtensions: file ? supportedExtensions(source) : [],
      configKey: camelize(flag),
      file,
      flag,
      name,
      required: required.includes(name),
      schema: file && resolvedItems !== undefined ? resolvedItems : resolvedField,
    }
  })
}

const requestBodyBinding = (
  document: OpenAPISpec,
  source: SourceOperation,
): RequestBodyBinding | undefined => {
  const requestBody = source.operation.requestBody
  if (requestBody === undefined) {
    return undefined
  }
  if (requestBody.required !== true) {
    throw new Error(
      `${source.operation.operationId}: only required request bodies are supported; found required=${JSON.stringify(requestBody.required)}`,
    )
  }
  const contents = Object.entries(requestBody.content)
  if (contents.length !== 1) {
    throw new Error(
      `${source.operation.operationId} ${source.method.toUpperCase()} ${source.path}: expected one request media type; found ${contents.length}`,
    )
  }
  const content = contents[0]
  if (content === undefined) {
    throw new Error(`${source.operation.operationId}: missing request body content`)
  }
  if (content[0] === "application/json") {
    return {
      kind: "json",
      mediaType: content[0],
      schema: content[1].schema,
      schemaName: `${String.capitalize(camelize(source.operation.operationId))}RequestJson`,
    }
  }
  if (content[0] === "multipart/form-data") {
    const fields = multipartFields(document, source, content[1].schema)
    const fileFields = fields.filter((field) => field.file)
    const fileField = fileFields[0]
    if (fileField === undefined || fileFields.length !== 1) {
      throw new Error(`${source.operation.operationId}: expected exactly one multipart file field`)
    }
    return {
      fields,
      file: fileField,
      kind: "multipart",
      mediaType: content[0],
      schema: content[1].schema,
    }
  }
  throw new Error(
    `${source.operation.operationId} ${source.method.toUpperCase()} ${source.path}: unsupported request media type ${content[0]}`,
  )
}

const renderMultipartField = (field: MultipartFieldBinding): string => {
  if (!field.required) {
    throw new Error(`Optional multipart field ${field.name} is not supported`)
  }
  if (field.file) {
    return `Flag.string(${JSON.stringify(field.flag)}).pipe(\n      Flag.between(1, 1),\n      Flag.withMetavar("FILE"),\n      Flag.withDescription(${JSON.stringify(`Required multipart file: ${field.name}. Accepted extensions: ${field.acceptedExtensions.join(", ")}. Exactly one file.`)}),\n    )`
  }
  const parameter: OpenAPISpecParameter = {
    description: schemaLabel(field.schema) ?? field.name,
    in: "query",
    name: field.name,
    required: field.required,
    schema: field.schema,
  }
  const rendered = renderScalarFlag({
    configKey: field.configKey,
    flag: field.flag,
    parameter,
    schema: field.schema,
  })
  return `${rendered}.pipe(\n      Flag.withDescription(${JSON.stringify(`Required multipart field: ${field.name} — ${schemaLabel(field.schema) ?? field.name}`)}),\n    )`
}

const renderOperation = (
  document: OpenAPISpec,
  source: SourceOperation,
  route: { readonly action: string; readonly resource: string },
  generation: FamilyGeneration,
): { readonly exportName: string; readonly source: string } => {
  const { method, operation, path } = source
  const bindings = parameterBindings(document, source)
  const body = requestBodyBinding(document, source)
  const mutation = method !== "get" && method !== "head"
  const bodyFlags =
    body === undefined
      ? []
      : body.kind === "json"
        ? ["payload"]
        : body.fields.map((field) => field.flag)
  const syntheticFlags = [...bodyFlags, ...(mutation ? ["confirm"] : [])]
  const duplicateSynthetic = syntheticFlags.find((flag) =>
    bindings.some((binding) => binding.flag === flag),
  )
  if (duplicateSynthetic !== undefined) {
    throw new Error(`Duplicate generated flag ${duplicateSynthetic}`)
  }
  const definition = {
    action: route.action,
    description: operationDescription(operation),
    family: generation.family,
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
    requestBody:
      body === undefined
        ? null
        : {
            fields:
              body.kind === "json"
                ? []
                : body.fields.map((field) => ({
                    acceptedExtensions: field.acceptedExtensions,
                    file: field.file,
                    flag: field.flag,
                    name: field.name,
                    required: field.required,
                    schema: bundleSchema(document, field.schema),
                  })),
            kind: body.kind,
            mediaType: body.mediaType,
            required: true,
            schema: bundleSchema(document, body.schema),
          },
    resource: route.resource,
    responses: renderResponses(document, operation),
    safety: mutation ? "mutation" : "read",
  }
  const exportName = camelize(operation.operationId)
  const definitionSource = JSON.stringify(definition)
  const renderedParameters = [
    ...bindings.map(
      (binding) =>
        `    ${JSON.stringify(binding.configKey)}: ${renderFlag(binding).replaceAll("\n", "\n    ")},`,
    ),
    ...(body === undefined
      ? []
      : body.kind === "json"
        ? [
            `    "payload": Flag.string("payload").pipe(\n      Flag.withMetavar("FILE"),\n      Flag.withDescription("Required ${body.mediaType} request body file"),\n    ),`,
          ]
        : body.fields.map(
            (field) =>
              `    ${JSON.stringify(field.configKey)}: ${renderMultipartField(field).replaceAll("\n", "\n    ")},`,
          )),
    ...(mutation
      ? [
          '    "confirm": Flag.boolean("confirm").pipe(Flag.withDescription("Confirm this mutating Spiko Operation")),',
        ]
      : []),
  ].join("\n")
  const parameters = renderedParameters === "" ? "{}" : `{\n${renderedParameters}\n  }`
  // Multipart file flags are Flag.between(1, 1), so parsing guarantees one
  // value; the empty-string fallback only satisfies indexed-access checking and
  // is unreachable because the extension check would reject it anyway.
  const prepare =
    body === undefined
      ? "input => Effect.succeed(input)"
      : body.kind === "json"
        ? `input => readJsonPayload(input["payload"], ${generation.clientModule}.${body.schemaName}).pipe(\n    Effect.map((payload) => ({ ...input, payload })),\n  )`
        : `input => readMultipartFile(input[${JSON.stringify(body.file.configKey)}][0] ?? "", ${JSON.stringify(body.file.acceptedExtensions)}).pipe(\n    Effect.map((file) => ({ ...input, [${JSON.stringify(body.file.configKey)}]: [file] })),\n  )`
  const bodyExpression =
    body === undefined
      ? undefined
      : body.kind === "json"
        ? 'input["payload"]'
        : `{ ${body.fields
            .map(
              (field) => `${JSON.stringify(field.name)}: input[${JSON.stringify(field.configKey)}]`,
            )
            .join(", ")} }`

  return {
    exportName,
    source: `export const ${exportName} = defineOperation({
  confirmed: ${mutation ? 'input => input["confirm"]' : "() => true"},
  definition: ${definitionSource},
  parameters: ${parameters},
  prepare: ${prepare},
  invoke: ${renderInvocation(source, bindings, generation.clientTag, bodyExpression)},
})`,
  }
}

// Failures while rendering one Operation must identify that Operation. Inner
// messages stay locality-scoped; this wrapper contributes the OpenAPI identity
// once so per-message context plumbing stays unnecessary.
const withOperationContext = <T>(source: SourceOperation, render: () => T): T => {
  const label = `${source.operation.operationId} ${source.method.toUpperCase()} ${source.path}`
  try {
    return render()
  } catch (error) {
    if (error instanceof Error && !error.message.includes(source.operation.operationId)) {
      error.message = `${label}: ${error.message}`
    }
    throw error
  }
}

const renderFamily = (document: OpenAPISpec, generation: FamilyGeneration): string => {
  const operations = collectOperations(document)
  if (operations.length !== generation.count) {
    throw new Error(
      `The ${String.capitalize(generation.family)} OpenAPI document must contain ${generation.count} Operations; found ${operations.length}`,
    )
  }
  const operationIds = Map.groupBy(operations, ({ operation }) => operation.operationId)
  const duplicateIds = Array.from(operationIds, ([id, matches]) => ({ id, matches })).filter(
    ({ matches }) => matches.length > 1,
  )
  if (duplicateIds.length > 0) {
    throw new Error(
      `Duplicate ${String.capitalize(generation.family)} operationId(s): ${duplicateIds.map(({ id }) => id).join(", ")}`,
    )
  }
  const missingMethods = operations
    .map(({ operation }) => camelize(operation.operationId))
    .filter((method) => !generation.clientMethods.has(method))
  if (missingMethods.length > 0) {
    throw new Error(
      `Missing generated ${String.capitalize(generation.family)} client method(s): ${missingMethods.join(", ")}`,
    )
  }
  const invalidIdentifiers = operations
    .map((source) => ({ source, name: camelize(source.operation.operationId) }))
    .filter(({ name }) => !identifierPattern.test(name) || reservedWords.has(name))
  if (invalidIdentifiers.length > 0) {
    throw new Error(
      `Invalid generated identifier(s): ${invalidIdentifiers
        .map(
          ({ source, name }) =>
            `${source.operation.operationId} ${source.method.toUpperCase()} ${source.path} -> ${JSON.stringify(name)}`,
        )
        .join(";")}`,
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
  const rendered = operations.map((source, index) =>
    withOperationContext(source, () => {
      const route = routes[index]
      if (route === undefined) {
        throw new Error("Missing generated CLI route")
      }
      return renderOperation(document, source, route, generation)
    }),
  )
  const mediaTypes = operations.flatMap(({ operation }) =>
    operation.requestBody === undefined ? [] : Object.keys(operation.requestBody.content),
  )
  const hasJsonBodies = mediaTypes.includes("application/json")
  const hasMultipartBodies = mediaTypes.includes("multipart/form-data")
  const bodyHelperImports = [
    ...(hasJsonBodies ? ["readJsonPayload"] : []),
    ...(hasMultipartBodies ? ["readMultipartFile"] : []),
  ]
  const familyName = String.capitalize(generation.family)
  return `// This file is generated by tools/generate-clients.ts. Do not edit it by hand.

import * as ${generation.clientModule} from "@spiko/${generation.family}-api-client"
import { Effect, Option, Schema } from "effect"
import { Flag } from "effect/unstable/cli"
import { defineOperation${bodyHelperImports.length > 0 ? `, ${bodyHelperImports.join(", ")}` : ""} } from "../cli.ts"

${rendered.map(({ source }) => source).join("\n\n")}

export const ${familyName}Operations = [
${rendered.map(({ exportName }) => `  ${exportName},`).join("\n")}
] as const
`
}

export const generateCliFiles = (
  documents: ReadonlyArray<CliSourceDocument>,
): ReadonlyArray<GeneratedCliFile> => {
  const publicDocument = documents.find((source) => source.family === "public")
  const investorDocument = documents.find((source) => source.family === "investor")
  const distributorDocument = documents.find((source) => source.family === "distributor")
  if (
    publicDocument === undefined ||
    investorDocument === undefined ||
    distributorDocument === undefined
  ) {
    throw new Error("The Public, Investor, and Distributor OpenAPI documents are required")
  }

  return [
    {
      content: renderFamily(publicDocument.document, {
        clientMethods: publicDocument.clientMethods,
        clientModule: "Public",
        clientTag: "Public.PublicApi",
        count: 15,
        family: "public",
      }),
      path: "apps/cli/src/generated/public.ts",
    },
    {
      content: renderFamily(investorDocument.document, {
        clientMethods: investorDocument.clientMethods,
        clientModule: "Investor",
        clientTag: "Investor.InvestorApi",
        count: 35,
        family: "investor",
      }),
      path: "apps/cli/src/generated/investor.ts",
    },
    {
      content: renderFamily(distributorDocument.document, {
        clientMethods: distributorDocument.clientMethods,
        clientModule: "Distributor",
        clientTag: "Distributor.DistributorApi",
        count: 65,
        family: "distributor",
      }),
      path: "apps/cli/src/generated/distributor.ts",
    },
  ]
}
