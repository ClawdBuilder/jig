### Fixed

- `api list` and `api show` call a request in `api.reads` a read only outside production, the same rule the call itself uses; showing one in production said "reads" for a call that will ask.
