export type VisualChangeCycleState = 'initial' | 'review-required' | 'correction-requested' | 'accepted' | 'abandoned';
export function deriveVisualChangeCycleState(workflow: { attempts: Array<{ review: { state: 'pending'|'correction-requested'|'accepted'|'abandoned' } }> }): VisualChangeCycleState {
  const latest = workflow.attempts.at(-1); if (latest === undefined) return 'initial'; return latest.review.state === 'pending' ? 'review-required' : latest.review.state;
}
