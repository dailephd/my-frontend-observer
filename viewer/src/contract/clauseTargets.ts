import type { ContractPrimitive } from '../types/contracts.js';

/**
 * Presentation-only extraction of the explicit stable target name(s) a
 * contract primitive names - never inferred by parsing prose, never applied
 * to page-level primitives (`document-width-fits-viewport`,
 * `scroll-owner-is-document`), which have no target to highlight.
 */
export function primitiveTargetNames(primitive: ContractPrimitive): string[] {
  switch (primitive.kind) {
    case 'target-visible':
    case 'target-not-clipped':
    case 'target-width-within-bound':
    case 'target-does-not-own-scroll':
    case 'target-begins-below-initial-viewport':
    case 'property-unchanged-within-tolerance':
    case 'property-increases':
    case 'property-decreases':
      return [primitive.target];
    case 'targets-do-not-overlap':
    case 'target-wider-than':
    case 'target-follows-vertically':
      return [primitive.targetA, primitive.targetB];
    case 'target-fits-inside':
      return [primitive.target, primitive.container];
    case 'relationship-unchanged':
      return [primitive.subjectTarget, primitive.relatedTarget].filter((v): v is string => v !== undefined);
    case 'document-width-fits-viewport':
    case 'scroll-owner-is-document':
      return [];
    default:
      return [];
  }
}
