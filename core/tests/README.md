# Existing check executables

This directory holds executable check files and fixtures; it is not a coverage or
retention registry. Check code can live beside the component or extension it
exercises; no test-folder hierarchy is required.

Use [developer verification](../../DEVELOPER-CONTEXT.md#verification-and-delivery)
to select affected lasting checks and temporary tests for new work.
Temporary probes are run and deleted when their purpose is resolved. Builders use
whatever [development checks](../../BUILDERS.md#testing-through-the-use-context)
get an extension working smoothly, then remove those checks. Building extensions
does not require a core checkout or a permanent builder test suite.

Run selected executable files directly, for example:

```sh
node --test core/tests/offset-remnants.test.mjs
node --test skills/vase-wall/tests/vase.test.mjs
```

`npm test` runs the stored suite; stress tests (`npm run test:stress`) and the
optional document check (`node scripts/check-repo.mjs`) are separate. A focused
check does not require a subsequent whole-suite run; follow checkout-local limits.
First-use capability is checked by [setup](../../SETUP.md). The [CI workflow](../../.github/workflows/test.yml)
provides its `test` status through `npm run setup:check`; that status does not
establish passing lasting checks.

Use isolated fixtures and homes. `saamHome()` refuses the person's home under
`node --test`: a test reaching it imports [temporary-home.mjs](./temporary-home.mjs)
first. Tests on the product are separate from validation inside its normal pipeline.
