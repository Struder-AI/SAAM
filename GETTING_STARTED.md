# Getting started with SAAM

SAAM is designed to start with a conversation, not a CAD or slicer tutorial.
From the repository root, run:

```sh
npm run first-run
```

On a fresh checkout this command checks Node.js, installs the exact dependencies
recorded in `package-lock.json`, exercises the geometry kernels, and verifies an
unapproved geometry preview through SAAM Studio. It records successful setup in
the ignored `.saam/` folder. Later runs are fast; setup repeats only when the lock
file changes or `node_modules/` is missing.

The command then offers a five-step guided tour. The tour is optional:

```sh
npm run first-run -- --tour
npm run first-run -- --skip-tour
```

The tour explains the normal flow: describe the part, inspect and approve its
geometry, review the printing process, inspect and approve the toolpath, and
export the exact machine program that was reviewed. Setup and the tour never
create a manufacturing approval, export a machine program, or start hardware.

## What you need

- Node.js 22 or newer. Active LTS versions are recommended.
- `npm`, which is included with Node.js.
- A compatible AI coding agent if you want the conversational workflow.

No global SAAM package, Rhino desktop installation, .NET runtime, printer
connection, or G-code utility is required for normal setup. If installation or a
runtime check fails, the first-run command stops and reports the failing step
instead of recording the checkout as ready.

## Make your first part

Open this repository with your agent and describe the object in ordinary
language. Include its purpose and important dimensions. The agent will select
the relevant SAAM skills and open Studio at each human review point. Personal
print bundles remain local in the ignored `Prints/` directory.

For development work, continue with [CONTRIBUTING.md](CONTRIBUTING.md). For the
maker review and approval flow, see [MAKERS.md](MAKERS.md).
