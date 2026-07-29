# Reply to Hathor: nano contract logs

Short version: it works, and the problem was on our side — we were asking
for the wrong id.

---

Thanks — running the tests was the right advice, and it turned up the
answer without needing the playground: the logs endpoint serves our
`self.log` entries fine on the **partner node** (testnet-india), for
**successful** transactions.

The mistake was ours. We were querying by **contract id**:

    GET /v1a/nano_contract/logs?id=<CONTRACT_ID>

which returns only the contract's own instantiation — that's the
"initialize entry" we reported.

Querying by **transaction id** returns the execution logs for that call:

    GET /v1a/nano_contract/logs?id=<TX_HASH>

Two real results from our v5 arena
(`0061589e138059dcc670e392442c55bd6a55487adaa0b519ad41cf09bb0129b4`):

`join_guild` — `"nc_execution": "success"`

    CALL_BEGIN  DEBUG  join_guild
    LOG         INFO   guild_joined   key_values: { guild_id: "0" }
    CALL_END    DEBUG

`fight_world_boss` — `"nc_execution": "success"`

    CALL_BEGIN  DEBUG  fight_world_boss
    LOG         INFO   world_boss_hit  key_values: { week: "2951", damage: "0" }
    CALL_END    DEBUG

So: `self.log.info(msg, **kwargs)` entries appear with their keyword
arguments intact, values serialised as strings, and failures carry the
`NCFail` traceback under `error_traceback` in the same shape.

We've switched our world feed over to it. Previously we inferred duel
outcomes by diffing contract state around each settling transaction,
which needed a prior sighting of both fighters and had to stay silent
when two of them moved at once. Now we read `duel_settled`
(`winner_side`, `r0/r1/r2`, `hardened`) and `world_boss_hit` (`damage`)
straight from the transaction's own log, with the old inference kept only
as a fallback.

Two things it would help to know:

1. **Retention.** How long do nodes keep execution logs — is it bounded by
   `NCLogConfig`, by storage, or not pruned at all? We cache what we read,
   but we'd like to know when to stop asking.
2. **`NCLogConfig` in production.** Do the partner and public nodes run
   `ALL`, or something narrower? We see successes and failures on the
   partner node today; we'd rather not build on it if that's incidental.

No action needed on the original ticket — it was our query, not your
node.
