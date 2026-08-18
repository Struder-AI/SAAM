# Security Policy

## Reporting a vulnerability

Please report suspected security issues privately, not in a public issue
or pull request. Use GitHub's private vulnerability reporting for this
repository (**Security** tab &rarr; **Report a vulnerability**).

Include what you found, the affected package or file, and, if you have
one, a minimal way to reproduce it. You do not need a working exploit to
report a concern.

## Scope

SAAM's operations, schemas, and generators run locally and produce
inspectable data or code for human review; the MVP does not transmit
commands to physical hardware. Treat as in scope:

- anything that could make a generated process plan or machine program
  silently diverge from what a human approved,
- anything that could let untrusted input reach a shell, filesystem
  write, or network call outside a package's declared purpose, and
- credential, secret, or private-data handling in any adapter or
  interface.

Physical machine safety is a separate, non-software concern: no test,
preview, or validation pass in this repository proves that a specific
machine, tool, or material configuration is safe to run. See
`docs/safety/` for how the project labels evidence.

## Response

Maintainers aim to acknowledge a report within a few days and to share a
remediation plan once the issue is understood. Coordinated disclosure is
preferred; please give maintainers a chance to ship a fix before public
disclosure.
