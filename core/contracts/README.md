# Observations and publication

`observations.mjs` retains debug observations of values where they cross between
responsibilities, keyed by wire identity; Runtime's `read_contract_observations`
lists their metadata or reads one captured occurrence by `id`. `observation-json.mjs`,
`observation-lease.mjs` and `observation-spool.mjs` admit, stage and lease those
captures. `numerical-json.mjs` defines the declared numerical observation profile,
and `slice-receivers.mjs` the owner-defined numerical representations of Slice's
receiver read sets; neither observes work nor activates a capture policy.

`publication.mjs` is the boundary shared by the application package and the
published source reader: which files a release ships and which a source read may
return.
