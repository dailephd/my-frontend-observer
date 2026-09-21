import type { ObservationArtifact } from '../domain/schema.js';
import type { VisualAnnotationArtifact, VisualAnnotationItem, RuntimeAnnotationAssociation } from '../domain/visualAnnotation.js';
import { isValidVisualAnnotationArtifact } from '../domain/visualAnnotation.js';
import type { ContractPrimitive, PerChangeClause, PerChangeContract } from '../domain/frontendContracts.js';
import { CONTRACT_ARTIFACT_KIND, CONTRACT_SCHEMA_VERSION, isValidContractPrimitive } from '../domain/frontendContracts.js';
import { buildClauseIdentity, buildFrontendContractInstanceIdentity, buildFrontendContractRequestIdentity } from '../domain/frontendContractIdentity.js';
import { persistPerChangeContract } from './frontendContractPersistenceService.js';

export interface PromoteVisualAnnotationContractOptions {
  annotation: VisualAnnotationArtifact;
  sourceObservation: ObservationArtifact;
  selectedItemIds: readonly string[];
  activeBaselineIds: readonly string[];
  outputLocation: string;
  cwd?: string;
}

export type PromoteVisualAnnotationContractFailureCode = 'invalid-annotation' | 'unsupported-source' | 'source-mismatch' | 'invalid-selection' | 'persistence-failed';

export type PromoteVisualAnnotationContractResult =
  | {
      ok: true;
      contractId: string;
      contractRequestId: string;
      artifactRoot: string;
      manifestPath: string;
      clauseCount: number;
    }
  | {
      ok: false;
      code: PromoteVisualAnnotationContractFailureCode;
      reason: string;
    };

/** Maximum number of selected items accepted in one promotion (the annotation itself is bounded to 100 items). */
export const MAX_PROMOTION_ITEM_IDS = 100;

function fail(code: PromoteVisualAnnotationContractFailureCode, reason: string): PromoteVisualAnnotationContractResult {
  return { ok: false, code, reason };
}

type ChangeIntent = Extract<Extract<VisualAnnotationItem['interpretation'], { state: 'confirmed' }>['intent'], { kind: 'change' }>;

const MOVE_PROPERTIES = new Set(['x', 'y']);
const RESIZE_PROPERTIES = new Set(['width', 'height']);
const PRESERVE_PROPERTIES = new Set(['x', 'y', 'width', 'height']);

/**
 * The bounded v0.9 promotion mapping check: a confirmed change primitive must
 * be one of the first annotation mappings AND its subject must equal the
 * item's explicit association. Anything else is refused, never coerced.
 */
function primitiveMatchesAssociation(operation: ChangeIntent['operation'], primitive: ContractPrimitive, association: RuntimeAnnotationAssociation): boolean {
  switch (operation) {
    case 'move':
    case 'resize': {
      if (association.kind !== 'runtime-target') return false;
      if (primitive.kind !== 'property-increases' && primitive.kind !== 'property-decreases') return false;
      if (primitive.minimumDeltaPx !== undefined) return false;
      const allowed = operation === 'move' ? MOVE_PROPERTIES : RESIZE_PROPERTIES;
      return primitive.target === association.target && allowed.has(primitive.property);
    }
    case 'preserve':
      if (association.kind === 'runtime-target') {
        return primitive.kind === 'property-unchanged-within-tolerance' && primitive.target === association.target && PRESERVE_PROPERTIES.has(primitive.property);
      }
      return (
        primitive.kind === 'relationship-unchanged' &&
        primitive.relationshipKind === association.relationshipKind &&
        primitive.subjectTarget === association.subjectTarget &&
        primitive.relatedTarget === association.relatedTarget
      );
    default:
      return false;
  }
}

/** Why one selected item cannot become a canonical contract clause, or undefined when it can. */
export function contractPromotionBlockReason(item: VisualAnnotationItem): string | undefined {
  const { interpretation } = item;
  if (interpretation.state === 'uninterpreted') return 'the item has no interpretation';
  if (interpretation.state === 'candidate') return 'the item interpretation is a candidate, not confirmed';
  const intent = interpretation.intent;
  if (intent.kind === 'inspect') return 'inspect intent is informational and never a contract clause';
  if (intent.kind !== 'change') return `"${intent.kind}" intent is not runtime change intent`;
  if (intent.operation === 'remove') return 'remove is not canonically promotable: the current frontend-contract vocabulary has no target-absent primitive';
  if (intent.contractPrimitive === undefined || !isValidContractPrimitive(intent.contractPrimitive)) return 'the confirmed change intent has no valid contract primitive';
  if (item.association === undefined) return 'the item has no explicit structured association';
  if (item.association.kind !== 'runtime-target' && item.association.kind !== 'runtime-relationship') return 'the item association is not runtime evidence';
  if (!primitiveMatchesAssociation(intent.operation, intent.contractPrimitive, item.association)) return 'the contract primitive does not match the explicit association and operation';
  return undefined;
}

function observationMatchesSource(annotation: VisualAnnotationArtifact, observation: ObservationArtifact): boolean {
  const source = annotation.source;
  if (source.kind !== 'runtime-observation') return false;
  const screenshot = observation.screenshot;
  return (
    observation.observationId === source.observationId &&
    observation.requestId === source.requestId &&
    observation.schemaVersion === source.observationSchemaVersion &&
    (screenshot.state === 'available' || screenshot.state === 'partial') &&
    screenshot.value.path === source.screenshot.path &&
    observation.requestConfig.viewport.width === source.coordinateSpace.width &&
    observation.requestConfig.viewport.height === source.coordinateSpace.height
  );
}

/**
 * v0.9 Batch 5: the one canonical annotation-to-contract use case. It turns
 * explicitly selected, confirmed, canonically promotable runtime change items
 * of one saved visual annotation into one ordinary `PerChangeContract`,
 * built only with the existing contract identity builders and persisted
 * exactly once through `persistPerChangeContract`.
 *
 * The whole promotion is refused if any selected item is not promotable
 * (never a partial contract). Clause order follows `selectedItemIds`.
 * `activeBaselineIds` are supplied by the caller from explicitly configured
 * baseline-contract evidence only. The annotation is never evaluated here -
 * the existing contract evaluator remains the only PASS/FAIL authority.
 */
export async function promoteVisualAnnotationContract(options: PromoteVisualAnnotationContractOptions): Promise<PromoteVisualAnnotationContractResult> {
  const { annotation, sourceObservation, selectedItemIds, activeBaselineIds } = options;

  const validation = isValidVisualAnnotationArtifact(annotation);
  if (!validation.valid) return fail('invalid-annotation', `visual annotation is invalid: ${validation.reason}`);
  if (annotation.source.kind !== 'runtime-observation') return fail('unsupported-source', 'only runtime-observation annotations can be promoted into a frontend change contract');
  if (!observationMatchesSource(annotation, sourceObservation)) return fail('source-mismatch', 'the supplied observation is not the exact canonical source of this annotation');

  if (selectedItemIds.length === 0) return fail('invalid-selection', 'select at least one confirmed annotation item to promote');
  if (selectedItemIds.length > MAX_PROMOTION_ITEM_IDS) return fail('invalid-selection', `at most ${MAX_PROMOTION_ITEM_IDS} items can be promoted at once`);
  if (new Set(selectedItemIds).size !== selectedItemIds.length) return fail('invalid-selection', 'selected annotation item ids must be unique');

  const itemsById = new Map(annotation.items.map((item) => [item.annotationItemId, item] as const));
  const clauses: PerChangeClause[] = [];
  for (const itemId of selectedItemIds) {
    const item = itemsById.get(itemId);
    if (item === undefined) return fail('invalid-selection', `selected annotation item "${itemId}" does not exist in this annotation`);
    const blocked = contractPromotionBlockReason(item);
    if (blocked !== undefined) return fail('invalid-selection', `annotation item "${itemId}" cannot be promoted: ${blocked}`);
    const intent = (item.interpretation as Extract<VisualAnnotationItem['interpretation'], { state: 'confirmed' }>).intent as ChangeIntent;
    const primitive = intent.contractPrimitive as ContractPrimitive;
    clauses.push({
      clauseId: buildClauseIdentity(primitive),
      category: intent.category,
      ...(intent.expectedDependentMode === undefined ? {} : { expectedDependentMode: intent.expectedDependentMode }),
      primitive,
      supportingEvidence: [{ path: `visualAnnotation.${annotation.annotationId}.source` }, { path: `visualAnnotation.${annotation.annotationId}.items.${item.annotationItemId}` }],
    });
  }

  const contractRequestId = buildFrontendContractRequestIdentity(
    annotation.source.observationId,
    clauses.map((clause) => ({ primitive: clause.primitive })),
    [],
  );
  const contractId = buildFrontendContractInstanceIdentity(contractRequestId);
  const contract: PerChangeContract = {
    artifactKind: CONTRACT_ARTIFACT_KIND,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractClass: 'change',
    contractId,
    contractRequestId,
    activeBaselineIds: [...activeBaselineIds],
    clauses,
  };

  const persisted = await persistPerChangeContract(contract, { outputLocation: options.outputLocation, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
  if (!persisted.ok) return fail('persistence-failed', persisted.diagnostics.map((d) => d.message).join('; '));

  return { ok: true, contractId, contractRequestId, artifactRoot: persisted.artifactRoot, manifestPath: persisted.manifestPath, clauseCount: clauses.length };
}
