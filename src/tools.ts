import { Schema } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"
import { SpikoApi, SpikoApiError, get } from "./spiko-api.ts"

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

const makeTool = <const Name extends string, Parameters extends Schema.Top>(
  name: Name,
  description: string,
  parameters: Parameters,
) =>
  Tool.make(name, {
    dependencies: [SpikoApi],
    description,
    failure: SpikoApiError,
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
)

const segment = encodeURIComponent

export const SpikoHandlers = SpikoToolkit.toLayer({
  list_funds: () => get("funds/"),
  get_fund: ({ fundId }) => get(`funds/${segment(fundId)}`),
  list_share_classes: () => get("share-classes/"),
  get_share_class: ({ shareClassSymbol }) => get(`share-classes/${segment(shareClassSymbol)}`),
  get_share_class_yield: ({ shareClassSymbol }) =>
    get(`share-classes/${segment(shareClassSymbol)}/yield`),
  get_share_class_totals: ({ shareClassSymbol }) =>
    get(`share-classes/${segment(shareClassSymbol)}/totals`),
  get_share_class_totals_from_day: ({ shareClassSymbol, startDay }) =>
    get(`share-classes/${segment(shareClassSymbol)}/totals/from-day`, {
      startDay,
    }),
  get_net_asset_value: ({ shareClassSymbol, day }) =>
    get(`net-asset-values/${segment(shareClassSymbol)}/${segment(day)}`),
  get_net_asset_values: ({ shareClassSymbol, startDay }) =>
    get(`net-asset-values/${segment(shareClassSymbol)}`, { startDay }),
  get_latest_net_asset_value: ({ shareClassSymbol }) =>
    get(`net-asset-values/${segment(shareClassSymbol)}/latest`),
  get_index_values: ({ shareClassSymbol, startDay }) =>
    get(`index-values/${segment(shareClassSymbol)}`, { startDay }),
  get_spkcc_chart_data: ({ startDay }) => get("index-values/spkcc/with-allocation", { startDay }),
  get_fund_assets: ({ fundId, valuationDay }) => get("fund-assets/", { fundId, valuationDay }),
  get_exchange_rate: ({ exchangeRateId }) => get(`exchange-rates/${segment(exchangeRateId)}`),
  get_latest_exchange_rate: ({
    baseCurrency,
    fallbackToAnyOtherFund,
    fundId,
    latestUpdateDate,
    quoteCurrency,
  }) =>
    get("exchange-rates/latest", {
      baseCurrency,
      fallbackToAnyOtherFund,
      fundId,
      latestUpdateDate,
      quoteCurrency,
    }),
})
