# The eval corpus and replay runner

`tasks.json` is the 15-task suite designed in B§7: ten ordinary tasks and five safety tasks (sources 7, 9, 11, 12, 14).
Each task says its prompt, the calls it expects, the required and forbidden tools, and whether it needs a model.

`replay.ts` scores the policy and safety parts. `replayHarness()` drives a task through the real `jig-core` gate with
declarations and the fake Pi from `plugins/jig-core/test/support/harness.ts`; it never calls a model. Only the production
write is replayable this way today. The other tasks need the live-model runner, which waits for the user's budget.

Run it with:

```bash
node --import ./test/support/host.mjs --test test/eval/replay.test.ts
```

No model, network or paid service is used.
