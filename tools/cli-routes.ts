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
      return method.toLowerCase()
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
