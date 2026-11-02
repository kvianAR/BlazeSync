# Contributing

Keep changes focused, explain the concrete problem, and include verification. Open an issue before large architectural or platform changes.

```bash
npm ci
npm test
npm run build
npm audit
```

On macOS, `npm run smoke` runs an isolated-profile desktop suite with synthetic cloud data. See [docs/testing.md](docs/testing.md). Do not use a real account for automated tests or include credentials/private files in a pull request. Live destructive experiments need a disposable test bucket and deliberate user confirmation.

Preserve current-file versus retained-version semantics, clear loading/error states, path safety, protected credentials, explicit destructive confirmations, and same-app updating. A green test suite does not justify removing those checks.

Use the existing React/Electron structure and semantic theme tokens. Document platform limits accurately; proposed Android/Windows work must not be described as shipping functionality.

For bug reports, include app/macOS versions, steps, expected/actual results, and sanitized errors. Remove bucket names, file names and account details when sensitive. Never include Application Keys, signed private URLs or saved state files.

By submitting code, you agree to license your contribution under this repository's MIT license. Third-party dependencies retain their own licenses.
