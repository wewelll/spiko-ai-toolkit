import * as String from "effect/String"

export interface CliRouteSource {
  readonly method: string
  readonly path: string
  readonly resource: string
}

export interface CliRoute {
  readonly action: string
  readonly resource: string
}

export interface CliOperationRouteSource extends CliRouteSource {
  readonly operationId: string
}

const pathParameter = /^\{[^}]+\}$/
const apiVersion = /^v\d+$/

const methodAction = (method: string, hasPathParameters: boolean): string => {
  switch (method) {
    case "GET":
    case "HEAD":
      return hasPathParameters ? "get" : "list"
    case "POST":
      return "create"
    case "DELETE":
      return "delete"
    case "PATCH":
    case "PUT":
      return "update"
    default:
      // Route policy only covers the HTTP methods the CLI can classify; fail
      // generation instead of silently routing unsupported methods such as
      // OPTIONS or TRACE.
      throw new Error(`Unsupported HTTP method for generated CLI routes: ${method}`)
  }
}

export const routeOperation = (source: CliRouteSource): CliRoute => {
  const segments = source.path.split("/").filter((segment) => segment.length > 0)
  const unversioned = apiVersion.test(segments[0] ?? "") ? segments.slice(1) : segments
  const resourceIndex = unversioned.indexOf(source.resource)
  const relative = resourceIndex === -1 ? unversioned : unversioned.slice(resourceIndex + 1)
  const staticSegments = relative.filter((segment) => !pathParameter.test(segment))
  const action =
    staticSegments.length === 0
      ? methodAction(
          source.method,
          relative.some((segment) => pathParameter.test(segment)),
        )
      : staticSegments.map(String.kebabCase).join("-")

  return {
    action,
    resource: String.kebabCase(source.resource),
  }
}

export const routeOperations = (
  sources: ReadonlyArray<CliOperationRouteSource>,
): ReadonlyArray<CliRoute> => {
  const candidates = sources.map((source) => {
    const route = routeOperation(source)
    const operationName = source.operationId.split(".").at(-1) ?? source.operationId
    const semanticVerb = String.kebabCase(operationName).split("-")[0]
    const genericMutation =
      route.action === "create" || route.action === "delete" || route.action === "update"
    return genericMutation &&
      semanticVerb !== undefined &&
      semanticVerb !== "create" &&
      semanticVerb !== "delete" &&
      semanticVerb !== "get" &&
      semanticVerb !== "update"
      ? { ...route, action: semanticVerb }
      : route
  })
  const baseCounts = Map.groupBy(candidates, ({ action, resource }) => `${resource}/${action}`)
  const resolved = candidates.map((route, index) => {
    const source = sources[index]
    if (source === undefined) {
      throw new Error(`Missing source for generated CLI route ${route.resource}/${route.action}`)
    }
    return {
      action:
        baseCounts.get(`${route.resource}/${route.action}`)?.length === 1
          ? route.action
          : (() => {
              const fallback = String.kebabCase(source.operationId)
              const prefix = `${route.resource}-`
              return fallback.startsWith(prefix) ? fallback.slice(prefix.length) : fallback
            })(),
      resource: route.resource,
    }
  })
  const collisions = Array.from(
    Map.groupBy(resolved, ({ action, resource }) => `${resource}/${action}`),
    ([route, matches]) => ({ matches, route }),
  ).filter(({ matches }) => matches.length > 1)
  if (collisions.length > 0) {
    throw new Error(
      `Generated CLI route collision(s): ${collisions.map(({ route }) => route).join(", ")}`,
    )
  }
  return resolved
}
