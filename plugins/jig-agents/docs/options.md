# Options: Chosen RPC

**Chosen: RPC.** A child is a separate Pi process, started with `start-plan.ts` and driven over Pi's RPC protocol
(`child-process.ts`, `rpc.ts`). Pi's own package API offered no stable child lifecycle, and every alternative reviewed
in October 2026 either ran in-process or had no limits; the RPC route keeps `jig-core` and `jig-sandbox` in force and
lets the parent hold the child's questions and report. See the dated decision in [Decisions](../../../docs/decisions.md).

## Specialisation compared (2026-11-01)

The October comparison found no stable in-process child API; RPC was chosen because it keeps the child a real Pi with
`jig-core` and `jig-sandbox` in force. The dated entry is in [Decisions](../../../docs/decisions.md).
