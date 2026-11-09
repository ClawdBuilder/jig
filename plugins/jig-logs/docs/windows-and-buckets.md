# Windows and buckets

How a time window is read, cut into buckets and searched, and what a call does
when a bucket fails. Back to the [jig-logs overview](../README.md).

## Windows

A call searches one window of at most the longest window, `logs.maxWindow`, which
is 7 days unless the configuration says otherwise (see
[Configuration](configuration.md#the-longest-window)). It is either:
- **`window`:** a relative window that ends now. A whole number without a
  leading zero, then `m`, `h` or `d`: `30m`, `2h`, `1d`. By default the longest
  is `7d`, which is also `168h` or `10080m`. The default is `2h`, or the longest
  window when that is shorter;
- **`from` and `to`:** exact times, both given, with `to` after `from`. ISO 8601
  with a timezone, such as `2026-10-13T09:30:00Z` or `2026-10-13T17:30:00+05:30`;
  fractions of a second are allowed. The date must exist on the calendar (30
  February is refused), and a year before 2000 is refused. `to` is exclusive.

`window` cannot be combined with `from` and `to`. Older logs are read in slices:
one call for each period of up to the longest window. A refusal names
`logs.maxWindow` and the value in force, such as `at most 7d (logs.maxWindow)`.

## Buckets

The window is searched in buckets, one request each, one after another:

| Window | Searched in | Requests |
|---|---|---|
| Up to 6 hours | one bucket | 1 |
| Over 6 hours, up to 2 days | hour buckets | 7 to 48 |
| Over 2 days, up to the longest window | day buckets | 3 or more, one a day |

A week is 7 requests, and 45 days with `"maxWindow": "45d"` is 45. The last bucket is what is left of the window. A backend
that refuses a request over some length cuts every bucket to it (Loki says 721
hours by default, which no bucket reaches).

Buckets are searched from the end of the window that `order` names: `asc` starts
with the oldest bucket and `desc` with the newest.
- **A bucket asks for as many hits as are still wanted.** Once `size` hits are
  collected, each bucket that remains asks for 0 hits and only adds its exact
  count to the total.
- **Loki cannot count,** so there each remaining bucket asks for one line and adds
  that, and the total is a lower bound (see [Loki](loki.md#what-loki-cannot-give)).
- **The result lists the buckets in time order,** whichever end was searched
  first.

## When a bucket fails

A bucket that fails in a way a smaller request may get past is halved and tried
again. That covers:
- a backend that gives up (it is told to after 25 seconds) and marks its reply
  `timed_out`;
- a request cut at 30 seconds;
- a reply that reports lost shards;
- an HTTP 408 or 5xx answer;
- a connection that breaks;
- a window that Loki refuses as longer than its operator allows.

[Failures](failures.md#gaps-and-their-reasons) lists every reason and says which
ones are halved.

A half that fails is halved again, 4 times at most, so one hour becomes at most
16 pieces and 31 requests.
- A bucket under 2 seconds is not halved, and no bucket is once the call is out of
  requests for searches (see [Budgets](#budgets)).
- The answer of a bucket that was halved is thrown away, so no hit is counted
  twice.
- With `desc`, the later half is searched first.

What still fails is not hidden:
- a bucket that cannot be halved any more, and came back with `timed_out` or
  lost shards, keeps the hits it returned and is marked `partial`, with the
  reason;
- a bucket that has no usable answer is `missing`: a gap in the result, with its
  reason.

## Budgets

A call makes at most 64 requests and starts none after 80 seconds, below Pi's own
limit for a tool call. One request is kept back for the check for data, so
searches and halvings stop at 63.
- **A window over 48 days** has more day buckets than that leaves room for. It
  gets one request a day and 16 more, so a 90-day call makes at most 106 and
  reaches its last day.
- **The 80 seconds do not grow.** A long window over a busy index may reach them
  first; the days it did not reach are gaps, and a shorter call searches them.

The windows a call did not reach are gaps with the reason `request_budget` or
`time_budget`: the newest with `asc`, the oldest with `desc`. While a call runs,
it reports `searching staging logs, request 3` for each request, and never what
was searched for.

## The status

| Status | Meaning |
|---|---|
| `complete` | Every part of the window was searched |
| `partial` | Some parts were not, or answered only in part. `Gaps:` names them |
| `failed` | No part could be searched |

A total is exact (`412 hits`), or a lower bound (`at least 412 hits`) when a
window is missing or partial, or when the backend counted only up to a limit.

## When nothing is found

One more request counts the documents of the window that have the environment's
filter, without the phrase or query. The `Availability:` line then says whether
the window holds any documents at all. It proves nothing about how long logs are
kept.

Loki has no count to give, so there the request asks the selector alone for one
line, and the line says that the window holds documents, without a number.

When the call has already used its requests or its 80 seconds, the check is
not made. When the check fails, or finds nothing and reports a timeout or lost
shards, the line says `unknown`, with the reason. What the check sends is in
[Query grammar](query-grammar.md#the-check-for-data), and the lines are in
[Hit lines](hit-lines.md#a-result).
