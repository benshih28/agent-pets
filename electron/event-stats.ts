/** Counters for the event pipeline; surfaced only through the local diagnostics export. */
export const eventPipelineStats = {
  rateLimited: 0,
  droppedByBackpressure: 0,
  sendFailures: 0,
  historyFlushFailures: 0,
  historyRequeuedEvents: 0,
  historyDroppedHeartbeats: 0,
  historyDroppedEvents: 0,
}
