import { Context, Effect, Layer, Option, Redacted, Schema } from "effect"

export const serviceName = "spiko-cli"
export const investorApiKeyAccount = "investor-api-key"

interface KeyringEntry {
  readonly deleteCredential: (signal?: AbortSignal) => Promise<boolean>
  readonly getPassword: (signal?: AbortSignal) => Promise<string | undefined>
  readonly setPassword: (password: string, signal?: AbortSignal) => Promise<void>
}

export class CredentialStoreError extends Schema.TaggedErrorClass<CredentialStoreError>()(
  "CredentialStoreError",
  { message: Schema.String },
) {}

export interface CredentialStoreService {
  readonly getInvestorApiKey: Effect.Effect<Option.Option<Redacted.Redacted>, CredentialStoreError>
  readonly removeInvestorApiKey: Effect.Effect<boolean, CredentialStoreError>
  readonly setInvestorApiKey: (
    apiKey: Redacted.Redacted,
  ) => Effect.Effect<void, CredentialStoreError>
}

export class CredentialStore extends Context.Service<CredentialStore, CredentialStoreService>()(
  "@spiko/cli/CredentialStore",
) {}

const keyringError = (cause: unknown) =>
  new CredentialStoreError({
    message: `Unable to access the operating system keychain. Use SPIKO_INVESTOR_API_KEY for stateless authentication.${
      cause instanceof Error ? ` ${cause.message}` : ""
    }`,
  })

export const make = (entry: KeyringEntry): CredentialStoreService => ({
  getInvestorApiKey: Effect.tryPromise({
    try: (signal) => entry.getPassword(signal),
    catch: keyringError,
  }).pipe(Effect.map((apiKey) => Option.map(Option.fromNullishOr(apiKey), Redacted.make))),
  removeInvestorApiKey: Effect.tryPromise({
    try: async (signal) => {
      const current = await entry.getPassword(signal)
      return current === undefined ? false : entry.deleteCredential(signal)
    },
    catch: keyringError,
  }),
  setInvestorApiKey: Effect.fn("CredentialStore.setInvestorApiKey")((apiKey) =>
    Effect.tryPromise({
      try: (signal) => entry.setPassword(Redacted.value(apiKey), signal),
      catch: keyringError,
    }),
  ),
})

const withLiveEntry = <A>(operation: (entry: KeyringEntry, signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: async (signal) => {
      const { AsyncEntry } = await import("@napi-rs/keyring")
      return operation(new AsyncEntry(serviceName, investorApiKeyAccount), signal)
    },
    catch: keyringError,
  })

const live = CredentialStore.of({
  getInvestorApiKey: withLiveEntry((entry, signal) => entry.getPassword(signal)).pipe(
    Effect.map((apiKey) => Option.map(Option.fromNullishOr(apiKey), Redacted.make)),
  ),
  removeInvestorApiKey: withLiveEntry(async (entry, signal) => {
    const current = await entry.getPassword(signal)
    return current === undefined ? false : entry.deleteCredential(signal)
  }),
  setInvestorApiKey: Effect.fn("CredentialStore.setInvestorApiKey")((apiKey) =>
    withLiveEntry((entry, signal) => entry.setPassword(Redacted.value(apiKey), signal)),
  ),
})

export const layer = Layer.succeed(CredentialStore, live)
