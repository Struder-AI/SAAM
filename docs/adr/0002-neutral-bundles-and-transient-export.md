# Neutral bundles and transient Export

Owner direction, 2026-10-18:

> Bundle should not store exported gcode or other machine adapter code.

Bundle retains geometry, recipe, immutable neutral SAAMpath, reviewed input
snapshots and factual export receipts. Machine program templates remain in
extensions. Existing historical program files are not copied, required or used
by the current workflow; this change does not delete the user's old files.

Generation completes neutral construction and scheduling without invoking an
adapter. Studio reviews that saved result. The person's Export captures its path
and settings before queued work, then machine preparation/writing produces bytes
for download without storing them in the bundle. An adapter failure leaves saved
work intact. Production uses writer facts; optional interpretation remains a
developer diagnostic. This supersedes earlier program-retention descriptions.

The owner's “trivial migration only” rule applies: field aliases and direct
references are sufficient for supported manifests. Retired split-file bundles
receive a compact deprecation message; SAAM does not rebuild or copy their
artifacts during opening. Their files remain untouched.
