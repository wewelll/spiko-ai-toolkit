# Spiko Toolkit

The Spiko Toolkit exposes callable Spiko capabilities to human operators, agents, and automation harnesses.

## Language

**Spiko Operation**:
A callable action declared by a committed Spiko OpenAPI document and identified by its operation ID, method, and path.
_Avoid_: Endpoint, route, command

**Operation Definition**:
The authoritative description of one Spiko Operation's identity, accepted input, request body, and safety classification.
_Avoid_: Command metadata, route configuration

**Operation Catalog**:
The ordered collection of Operation Definitions exposed for Public, Investor, or Distributor.
_Avoid_: Command list, endpoint map
