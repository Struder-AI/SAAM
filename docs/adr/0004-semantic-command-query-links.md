# Link kinds express command and query semantics

2026-10-21. The owner clarified that architecture links have only command and
query semantics: "The link types are semantic in nature, and carry no non-semantic flavor."
The former value and control categories mixed payload or lifecycle subject with
interaction meaning, obscuring which operation receiving data requested.
Values remain payloads; cancellation and progress recording are commands, and
status reads are queries. The shared wire contract
owns interpretation independently of transport or callback implementation.
