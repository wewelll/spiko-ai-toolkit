import { InvestorApi, type InvestorApiClient } from "@spiko/investor-api-client"
import { PublicApi, type PublicApiClient } from "@spiko/public-api-client"
import { Effect, Predicate, Schema } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"
import {
  InvestorMutatingOperationNames,
  InvestorOperationCatalog,
  InvestorReadOperationNames,
  type InvestorOperationMetadata,
} from "./generated/investor-operations.ts"

const Day = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)).annotate({
  description: "A calendar day in YYYY-MM-DD format",
})

const Uuid = Schema.String.check(Schema.isUUID()).annotate({
  description: "A UUID",
})

const Currency = Schema.Literals(["EUR", "USD", "GBP", "CHF", "JPY", "SGD"])

const ShareClassSymbol = Schema.Literals([
  "EUTBL",
  "USTBL",
  "eurUSTBL",
  "SPKCC",
  "eurSPKCC",
  "UKTBL",
  "eurUKTBL",
  "SAFO",
  "SAFOd",
  "eurSAFO",
  "eurSAFOd",
  "gbpSAFO",
  "chfSAFO",
])

const Success = Schema.Struct({
  data: Schema.Unknown,
  source: Schema.String,
})

export class SpikoMcpError extends Schema.TaggedErrorClass<SpikoMcpError>()("SpikoMcpError", {
  message: Schema.String,
}) {}

const makeTool = <const Name extends string, Parameters extends Schema.Top>(
  name: Name,
  description: string,
  parameters: Parameters,
) =>
  Tool.make(name, {
    dependencies: [PublicApi],
    description,
    failure: SpikoMcpError,
    failureMode: "return",
    parameters,
    success: Success,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, true)

export const ListFunds = makeTool(
  "list_funds",
  "List all Spiko funds and their identifiers.",
  Schema.Struct({}),
)

export const GetFund = makeTool(
  "get_fund",
  "Get a Spiko fund by UUID.",
  Schema.Struct({ fundId: Uuid }),
)

export const ListShareClasses = makeTool(
  "list_share_classes",
  "List all Spiko share classes, including currencies, fees, and token addresses.",
  Schema.Struct({}),
)

export const GetShareClass = makeTool(
  "get_share_class",
  "Get one Spiko share class by symbol.",
  Schema.Struct({ shareClassSymbol: ShareClassSymbol }),
)

export const GetShareClassYield = makeTool(
  "get_share_class_yield",
  "Get the latest yield data for a Spiko share class.",
  Schema.Struct({ shareClassSymbol: ShareClassSymbol }),
)

export const GetShareClassTotals = makeTool(
  "get_share_class_totals",
  "Get the latest total assets and shares for a Spiko share class.",
  Schema.Struct({ shareClassSymbol: ShareClassSymbol }),
)

export const GetShareClassTotalsFromDay = makeTool(
  "get_share_class_totals_from_day",
  "Get total assets and shares for a Spiko share class from a given day.",
  Schema.Struct({ shareClassSymbol: ShareClassSymbol, startDay: Day }),
)

export const GetNetAssetValue = makeTool(
  "get_net_asset_value",
  "Get a Spiko share class net asset value for one day.",
  Schema.Struct({ shareClassSymbol: ShareClassSymbol, day: Day }),
)

export const GetNetAssetValues = makeTool(
  "get_net_asset_values",
  "Get Spiko share class net asset values starting on a given day.",
  Schema.Struct({ shareClassSymbol: ShareClassSymbol, startDay: Day }),
)

export const GetLatestNetAssetValue = makeTool(
  "get_latest_net_asset_value",
  "Get the latest net asset value for a Spiko share class.",
  Schema.Struct({ shareClassSymbol: ShareClassSymbol }),
)

export const GetIndexValues = makeTool(
  "get_index_values",
  "Get historical index values for a Spiko share class.",
  Schema.Struct({ shareClassSymbol: ShareClassSymbol, startDay: Day }),
)

export const GetSpkccChartData = makeTool(
  "get_spkcc_chart_data",
  "Get SPKCC index history with BTC, ETH, and cash allocation data.",
  Schema.Struct({ startDay: Day }),
)

export const GetFundAssets = makeTool(
  "get_fund_assets",
  "Get the assets held by a Spiko fund, optionally on a valuation day.",
  Schema.Struct({
    fundId: Uuid,
    valuationDay: Schema.optionalKey(Day),
  }),
)

export const GetExchangeRate = makeTool(
  "get_exchange_rate",
  "Get a Spiko exchange rate by UUID.",
  Schema.Struct({ exchangeRateId: Uuid }),
)

export const GetLatestExchangeRate = makeTool(
  "get_latest_exchange_rate",
  "Get the latest exchange rate for a fund and currency pair.",
  Schema.Struct({
    fundId: Uuid,
    baseCurrency: Currency,
    quoteCurrency: Currency,
    latestUpdateDate: Schema.optionalKey(Day),
    fallbackToAnyOtherFund: Schema.optionalKey(Schema.Boolean),
  }),
)

const InvestorOperation = Schema.Struct({
  description: Schema.String,
  method: Schema.String,
  name: Schema.String,
  parameters: Schema.Array(
    Schema.Struct({
      in: Schema.Literals(["query", "header", "path", "cookie"]),
      name: Schema.String,
      required: Schema.Boolean,
    }),
  ),
  path: Schema.String,
  requiresPayload: Schema.Boolean,
})

const InvestorResult = Schema.Struct({
  data: Schema.Unknown,
  operation: Schema.String,
  source: Schema.String,
})

const Parameters = Schema.Record(Schema.String, Schema.Json).annotate({
  description: "Query, header, and cookie parameters keyed by their OpenAPI names",
})

const PathParameters = Schema.Record(Schema.String, Schema.String).annotate({
  description: "Path parameters keyed by their OpenAPI names",
})

export const ListInvestorOperations = Tool.make("list_investor_operations", {
  description: "List every Investor API operation and the parameters accepted by the call tools.",
  failure: SpikoMcpError,
  failureMode: "return",
  parameters: Schema.Struct({}),
  success: Schema.Array(InvestorOperation),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const CallInvestorReadOperation = Tool.make("call_investor_read_operation", {
  dependencies: [InvestorApi],
  description:
    "Call any read-only Investor API operation. Use list_investor_operations to inspect its method, path, and parameters.",
  failure: SpikoMcpError,
  failureMode: "return",
  parameters: Schema.Struct({
    operation: Schema.Literals(InvestorReadOperationNames),
    parameters: Schema.optionalKey(Parameters),
    path: Schema.optionalKey(PathParameters),
  }),
  success: InvestorResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true)

export const CallInvestorMutatingOperation = Tool.make("call_investor_mutating_operation", {
  dependencies: [InvestorApi],
  description:
    "Call an Investor API operation that changes state. Review the operation and payload before confirming.",
  failure: SpikoMcpError,
  failureMode: "return",
  parameters: Schema.Struct({
    confirm: Schema.Literal(true),
    operation: Schema.Literals(InvestorMutatingOperationNames),
    parameters: Schema.optionalKey(Parameters),
    path: Schema.optionalKey(PathParameters),
    payload: Schema.optionalKey(Schema.Json),
  }),
  success: InvestorResult,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true)

export const SpikoToolkit = Toolkit.make(
  ListFunds,
  GetFund,
  ListShareClasses,
  GetShareClass,
  GetShareClassYield,
  GetShareClassTotals,
  GetShareClassTotalsFromDay,
  GetNetAssetValue,
  GetNetAssetValues,
  GetLatestNetAssetValue,
  GetIndexValues,
  GetSpkccChartData,
  GetFundAssets,
  GetExchangeRate,
  GetLatestExchangeRate,
  ListInvestorOperations,
  CallInvestorReadOperation,
  CallInvestorMutatingOperation,
)

const segment = encodeURIComponent

type QueryValue = boolean | number | string | undefined

const sourceUrl = (
  baseUrl: string,
  path: string,
  query: Readonly<Record<string, QueryValue>> = {},
): string => {
  const url = new URL(path.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`)

  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value))
    }
  }

  return url.toString()
}

const call = <A, E>(
  path: string,
  query: Readonly<Record<string, QueryValue>>,
  operation: (api: PublicApiClient) => Effect.Effect<A, E>,
): Effect.Effect<{ readonly data: A; readonly source: string }, SpikoMcpError, PublicApi> =>
  Effect.flatMap(PublicApi, (api) =>
    operation(api).pipe(
      Effect.map((data) => ({
        data,
        source: sourceUrl(api.baseUrl, path, query),
      })),
    ),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new SpikoMcpError({
          message: String(cause),
        }),
    ),
  )

type InvestorOperationName = keyof typeof InvestorOperationCatalog

const investorSourceUrl = (
  client: InvestorApiClient,
  metadata: InvestorOperationMetadata,
  pathParameters: Readonly<Record<string, string>>,
  parameters: Readonly<Record<string, Schema.Json>>,
): string => {
  const path = metadata.parameters
    .filter((parameter) => parameter.in === "path")
    .reduce(
      (value, parameter) =>
        value.replace(
          `{${parameter.name}}`,
          encodeURIComponent(pathParameters[parameter.name] ?? ""),
        ),
      metadata.path,
    )
  const url = new URL(path.replace(/^\/+/, ""), `${client.baseUrl.replace(/\/+$/, "")}/`)

  for (const parameter of metadata.parameters.filter((parameter) => parameter.in === "query")) {
    const value = parameters[parameter.name]
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(
          parameter.name,
          typeof item === "string" ? item : JSON.stringify(item),
        )
      }
    } else if (value !== undefined) {
      url.searchParams.set(
        parameter.name,
        typeof value === "string" ? value : JSON.stringify(value),
      )
    }
  }

  return url.toString()
}

const callInvestor = Effect.fn("Mcp.callInvestor")(function* (
  operationName: InvestorOperationName,
  pathParameters: Readonly<Record<string, string>> = {},
  parameters: Readonly<Record<string, Schema.Json>> = {},
  payload?: Schema.Json,
) {
  const api = yield* InvestorApi
  const metadata: InvestorOperationMetadata = InvestorOperationCatalog[operationName]
  const args: Array<unknown> = []

  for (const parameter of metadata.parameters) {
    const value =
      parameter.in === "path" ? pathParameters[parameter.name] : parameters[parameter.name]
    if (parameter.required && value === undefined) {
      return yield* new SpikoMcpError({
        message: `Missing required ${parameter.in} parameter "${parameter.name}" for ${operationName}`,
      })
    }
    if (parameter.in === "path") {
      args.push(value)
    }
  }

  if (metadata.requestBody !== undefined && payload === undefined) {
    return yield* new SpikoMcpError({
      message: `Missing required payload for ${operationName}`,
    })
  }

  const options: { params?: Readonly<Record<string, Schema.Json>>; payload?: Schema.Json } = {}
  if (metadata.parameters.some((parameter) => parameter.in !== "path")) {
    options.params = parameters
  }
  if (payload !== undefined) {
    options.payload = payload
  }
  args.push(options)

  const method: unknown = api[operationName]
  if (!Predicate.isFunction(method)) {
    return yield* new SpikoMcpError({
      message: `The Investor API client does not expose "${operationName}". Regenerate the clients.`,
    })
  }

  const result: unknown = method(...args)
  if (!Effect.isEffect(result)) {
    return yield* new SpikoMcpError({
      message: `The Investor API operation "${operationName}" did not return an Effect.`,
    })
  }

  const data = yield* result.pipe(
    Effect.mapError((cause) => new SpikoMcpError({ message: String(cause) })),
  )
  return {
    data,
    operation: operationName,
    source: investorSourceUrl(api, metadata, pathParameters, parameters),
  }
})

export const SpikoHandlers = SpikoToolkit.toLayer({
  list_funds: () => call("funds/", {}, (api) => api.GetAllFunds(undefined)),
  get_fund: ({ fundId }) =>
    call(`funds/${segment(fundId)}`, {}, (api) => api.GetFund(fundId, undefined)),
  list_share_classes: () => call("share-classes/", {}, (api) => api.GetAllShareClasses(undefined)),
  get_share_class: ({ shareClassSymbol }) =>
    call(`share-classes/${segment(shareClassSymbol)}`, {}, (api) =>
      api.GetShareClass(shareClassSymbol, undefined),
    ),
  get_share_class_yield: ({ shareClassSymbol }) =>
    call(`share-classes/${segment(shareClassSymbol)}/yield`, {}, (api) =>
      api.GetShareClassYield(shareClassSymbol, undefined),
    ),
  get_share_class_totals: ({ shareClassSymbol }) =>
    call(`share-classes/${segment(shareClassSymbol)}/totals`, {}, (api) =>
      api.GetShareClassTotals(shareClassSymbol, undefined),
    ),
  get_share_class_totals_from_day: ({ shareClassSymbol, startDay }) =>
    call(`share-classes/${segment(shareClassSymbol)}/totals/from-day`, { startDay }, (api) =>
      api.GetShareClassTotalsFromDay(shareClassSymbol, { params: { startDay } }),
    ),
  get_net_asset_value: ({ shareClassSymbol, day }) =>
    call(`net-asset-values/${segment(shareClassSymbol)}/${segment(day)}`, {}, (api) =>
      api.GetNetAssetValue(shareClassSymbol, day, undefined),
    ),
  get_net_asset_values: ({ shareClassSymbol, startDay }) =>
    call(`net-asset-values/${segment(shareClassSymbol)}`, { startDay }, (api) =>
      api.GetNetAssetValues(shareClassSymbol, { params: { startDay } }),
    ),
  get_latest_net_asset_value: ({ shareClassSymbol }) =>
    call(`net-asset-values/${segment(shareClassSymbol)}/latest`, {}, (api) =>
      api.GetLatestNetAssetValue(shareClassSymbol, undefined),
    ),
  get_index_values: ({ shareClassSymbol, startDay }) =>
    call(`index-values/${segment(shareClassSymbol)}`, { startDay }, (api) =>
      api.GetIndexValues(shareClassSymbol, { params: { startDay } }),
    ),
  get_spkcc_chart_data: ({ startDay }) =>
    call("index-values/spkcc/with-allocation", { startDay }, (api) =>
      api.GetSPKCCChartData({ params: { startDay } }),
    ),
  get_fund_assets: ({ fundId, valuationDay }) =>
    call("fund-assets/", { fundId, valuationDay }, (api) =>
      api.GetAllFundAssets({
        params: {
          fundId,
          ...(valuationDay === undefined ? {} : { valuationDay }),
        },
      }),
    ),
  get_exchange_rate: ({ exchangeRateId }) =>
    call(`exchange-rates/${segment(exchangeRateId)}`, {}, (api) =>
      api.GetExchangeRateByID(exchangeRateId, undefined),
    ),
  get_latest_exchange_rate: ({
    baseCurrency,
    fallbackToAnyOtherFund,
    fundId,
    latestUpdateDate,
    quoteCurrency,
  }) =>
    call(
      "exchange-rates/latest",
      {
        baseCurrency,
        fallbackToAnyOtherFund,
        fundId,
        latestUpdateDate,
        quoteCurrency,
      },
      (api) =>
        api.GetLatestExchangeRate({
          params: {
            baseCurrency,
            fundId,
            quoteCurrency,
            ...(fallbackToAnyOtherFund === undefined
              ? {}
              : { fallbackToAnyOtherFund: fallbackToAnyOtherFund ? "true" : "false" }),
            ...(latestUpdateDate === undefined ? {} : { latestUpdateDate }),
          },
        }),
    ),
  list_investor_operations: () =>
    Effect.succeed(
      Object.entries(InvestorOperationCatalog).map(([name, operation]) => {
        const metadata: InvestorOperationMetadata = operation
        return {
          description: metadata.description,
          method: metadata.method,
          name,
          parameters: metadata.parameters,
          path: metadata.path,
          requiresPayload: metadata.requestBody !== undefined,
        }
      }),
    ),
  call_investor_read_operation: ({ operation, parameters, path }) =>
    callInvestor(operation, path, parameters),
  call_investor_mutating_operation: ({ operation, parameters, path, payload }) =>
    callInvestor(operation, path, parameters, payload),
})
