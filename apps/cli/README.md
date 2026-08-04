# spiko-cli

Command-line client for [Spiko's APIs](https://docs.spiko.io/developers/introduction), built with TypeScript and Effect.

> This is an independent project and is not an official Spiko product.

## Installation

```sh
npm install --global spiko-cli
spiko --help
```

Persist an Investor API key securely in macOS Keychain, Windows Credential Manager, or Linux Secret Service:

```sh
spiko auth login
spiko auth status
```

Use the environment instead for CI or a temporary override:

```sh
export SPIKO_INVESTOR_API_KEY=your-api-key
spiko call investor investors
```

The key is sent as an `Authorization: Bearer` token. Environment credentials take precedence over the stored key. Run `spiko auth logout` to remove the stored key.

See the [Spiko AI Toolkit repository](https://github.com/wewelll/spiko-ai-toolkit) for documentation and source code.

## License

MIT
