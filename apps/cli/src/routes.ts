import * as String from "effect/String"
import type { OperationMetadata } from "./generated/operations.ts"

export interface OperationRoute {
  readonly action: string
  readonly isDefault: boolean
  readonly metadata: OperationMetadata
  readonly operationName: string
  readonly resource: string
}

interface RouteCandidate {
  readonly action: string
  readonly metadata: OperationMetadata
  readonly operationName: string
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

const baseAction = (metadata: OperationMetadata): string => {
  const segments = metadata.path.split("/").filter((segment) => segment.length > 0)
  const unversioned = apiVersion.test(segments[0] ?? "") ? segments.slice(1) : segments
  const resourceIndex = unversioned.indexOf(metadata.resource)
  const relative = resourceIndex === -1 ? unversioned : unversioned.slice(resourceIndex + 1)
  const staticSegments = relative.filter((segment) => !pathParameter.test(segment))

  return staticSegments.length === 0
    ? methodAction(
        metadata.method,
        relative.some((segment) => pathParameter.test(segment)),
      )
    : staticSegments.join("-")
}

const fallbackAction = (candidate: RouteCandidate): string => {
  const operation = String.kebabCase(candidate.operationName)
  const prefix = `${candidate.resource}-`
  return operation.startsWith(prefix) ? operation.slice(prefix.length) : operation
}

const selectDefault = (routes: ReadonlyArray<RouteCandidate>): RouteCandidate | undefined =>
  routes.find((route) => route.action === "list") ??
  routes.find((route) => route.action === "latest") ??
  (routes.length === 1 ? routes[0] : undefined)

export const routeOperations = (
  operations: Readonly<Record<string, OperationMetadata>>,
): ReadonlyArray<OperationRoute> => {
  const candidates = Object.entries(operations).map(([operationName, metadata]) => ({
    action: baseAction(metadata),
    metadata,
    operationName,
    resource: metadata.resource,
  }))
  const counts = new Map<string, number>()

  for (const candidate of candidates) {
    const key = `${candidate.resource}/${candidate.action}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const resolved = candidates.map((candidate) => ({
    ...candidate,
    action:
      counts.get(`${candidate.resource}/${candidate.action}`) === 1
        ? candidate.action
        : fallbackAction(candidate),
  }))

  const defaults = new Set(
    Array.from(Map.groupBy(resolved, (route) => route.resource).values()).flatMap((routes) => {
      const selected = selectDefault(routes)
      return selected === undefined ? [] : [selected.operationName]
    }),
  )

  return resolved.map((route) => ({
    ...route,
    isDefault: defaults.has(route.operationName),
  }))
}
