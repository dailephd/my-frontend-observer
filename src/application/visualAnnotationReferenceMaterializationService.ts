import { createHash } from 'node:crypto';
import path from 'node:path';
import type { VisualAnnotationArtifact, VisualAnnotationItem } from '../domain/visualAnnotation.js';
import { isValidVisualAnnotationArtifact } from '../domain/visualAnnotation.js';
import type { ExternalReferenceArtifact, ExternalReferenceImageReference } from '../domain/externalReference.js';
import { isApprovedExternalReferenceArtifact, isValidExternalReferenceArtifact } from '../domain/externalReference.js';
import type { ReferenceRegion } from '../domain/externalReferenceRegions.js';
import { isValidReferenceRegions } from '../domain/externalReferenceRegions.js';
import type { ExternalReferenceRequirement, RawReferenceRequirement } from '../domain/externalReferenceRequirements.js';
import { buildReferenceRequirement, deriveReferenceRequirementExpectation, isValidRawReferenceRequirement, isValidReferenceRequirements } from '../domain/externalReferenceRequirements.js';
import { importExternalReference } from './externalReferencePersistenceService.js';
import { readExternalReferenceArtifact } from '../artifacts/externalReferenceArtifactReader.js';
import { EXTERNAL_REFERENCE_MANIFEST_FILENAME } from '../artifacts/externalReferenceArtifactWriter.js';

export interface MaterializeVisualAnnotationReferenceOptions {
  annotation: VisualAnnotationArtifact;
  sourceReference: ExternalReferenceArtifact;
  /** Root directory of the selected source reference artifact, used only for canonical explicit supersession. */
  sourceReferenceRoot: string;
  /** The canonical source image bytes (verified here against the source image SHA-256). */
  imageBytes: Uint8Array;
  selectedItemIds: readonly string[];
  outputLocation: string;
  cwd?: string;
}

export type MaterializeVisualAnnotationReferenceFailureCode = 'invalid-source' | 'source-mismatch' | 'invalid-selection' | 'invalid-materialized-reference' | 'persistence-failure';

export type MaterializeVisualAnnotationReferenceResult =
  | {
      ok: true;
      referenceId: string;
      referenceRequestId: string;
      artifactRoot: string;
      manifestPath: string;
      imagePath: string;
      lifecycle: 'imported';
      supersedesReferenceId: string;
      regionCount: number;
      requirementCount: number;
    }
  | { ok: false; code: MaterializeVisualAnnotationReferenceFailureCode; reason: string };

/** Maximum number of selected items accepted in one materialization (the annotation itself is bounded to 100 items). */
export const MAX_MATERIALIZATION_ITEM_IDS = 100;

function fail(code: MaterializeVisualAnnotationReferenceFailureCode, reason: string): MaterializeVisualAnnotationReferenceResult {
  return { ok: false, code, reason };
}

type ReferenceIntent = Extract<Extract<VisualAnnotationItem['interpretation'], { state: 'confirmed' }>['intent'], { kind: 'reference-region' | 'reference-requirement' }>;

/** Why one selected item cannot be materialized into a reference revision, or undefined when it can. */
export function referenceMaterializationBlockReason(item: VisualAnnotationItem): string | undefined {
  const { interpretation } = item;
  if (interpretation.state === 'uninterpreted') return 'the item has no interpretation';
  if (interpretation.state === 'candidate') return 'the item interpretation is a candidate, not confirmed';
  const kind = interpretation.intent.kind;
  if (kind === 'inspect' || kind === 'asset-sensitive') return 'informational annotation intent is not materialized into the external-reference contract';
  if (kind !== 'reference-region' && kind !== 'reference-requirement') return `"${kind}" intent is not external-reference intent`;
  return undefined;
}

/** The persisted requirement's authored content only - `requirementId` is never carried over; the canonical import recomputes it. */
function toRawReferenceRequirement(requirement: ExternalReferenceRequirement): RawReferenceRequirement {
  return {
    category: requirement.category,
    ...(requirement.expectedDependentMode === undefined ? {} : { expectedDependentMode: requirement.expectedDependentMode }),
    subject: requirement.subject,
    ...(requirement.tolerance === undefined ? {} : { tolerance: requirement.tolerance }),
  };
}

function sourceImageOf(reference: ExternalReferenceArtifact): ExternalReferenceImageReference {
  return isApprovedExternalReferenceArtifact(reference) ? reference.sourceReference.image : (reference as Extract<ExternalReferenceArtifact, { image: unknown }>).image;
}

function sourceMatches(annotation: VisualAnnotationArtifact, reference: ExternalReferenceArtifact): boolean {
  const source = annotation.source;
  if (source.kind !== 'external-reference') return false;
  const approved = isApprovedExternalReferenceArtifact(reference);
  const image = sourceImageOf(reference);
  const imageOwnerReferenceId = approved ? reference.sourceReference.referenceId : reference.referenceId;
  return (
    source.referenceId === reference.referenceId &&
    source.referenceRequestId === reference.referenceRequestId &&
    source.referenceSchemaVersion === reference.schemaVersion &&
    source.lifecycle === reference.lifecycle.state &&
    source.imageOwnerReferenceId === imageOwnerReferenceId &&
    source.imageSha256 === image.sha256 &&
    source.coordinateSpace.width === image.width &&
    source.coordinateSpace.height === image.height
  );
}

/**
 * v0.9 Batch 6: the one canonical annotation-to-reference materialization use
 * case. Explicitly selected, confirmed `reference-region` (create/refine) and
 * `reference-requirement` items of one saved external-reference annotation are
 * composed onto the selected source reference's own regions, requirements,
 * applicability, and label, and persisted exactly once through the canonical
 * `importExternalReference` as a new imported revision that explicitly
 * supersedes the source. The source reference is never modified, never
 * approved, and its image bytes are reused verbatim.
 *
 * Composition order: source regions keep their order (a refined region keeps
 * its position and id, with the confirmed rectangle); created regions are
 * appended in selection order; then source requirements (content only) are
 * followed by selected requirements in selection order. Every selected
 * relationship requirement must still hold for the final region geometry,
 * checked through the canonical requirement expectation derivation. Any
 * invalid selected item rejects the whole materialization before any write.
 */
export async function materializeVisualAnnotationReference(options: MaterializeVisualAnnotationReferenceOptions): Promise<MaterializeVisualAnnotationReferenceResult> {
  const { annotation, sourceReference, selectedItemIds } = options;

  const annotationValidation = isValidVisualAnnotationArtifact(annotation);
  if (!annotationValidation.valid) return fail('invalid-source', `visual annotation is invalid: ${annotationValidation.reason}`);
  if (annotation.source.kind !== 'external-reference') return fail('invalid-source', 'only external-reference annotations can be materialized into a reference revision');
  const referenceValidation = isValidExternalReferenceArtifact(sourceReference);
  if (!referenceValidation.valid) return fail('invalid-source', `source external reference is invalid: ${referenceValidation.reason}`);
  if (!sourceMatches(annotation, sourceReference)) return fail('source-mismatch', 'the supplied reference is not the exact canonical source of this annotation');

  // Supersession is resolved by the canonical import service from this root, so it must hold exactly the supplied source.
  const rootRead = await readExternalReferenceArtifact(path.join(options.sourceReferenceRoot, EXTERNAL_REFERENCE_MANIFEST_FILENAME));
  if (!rootRead.ok || rootRead.artifact.referenceId !== sourceReference.referenceId) {
    return fail('source-mismatch', 'the source reference root does not contain the supplied source reference');
  }

  const image = sourceImageOf(sourceReference);
  if (createHash('sha256').update(options.imageBytes).digest('hex') !== image.sha256) {
    return fail('source-mismatch', 'the supplied image bytes do not match the source reference image SHA-256');
  }

  if (selectedItemIds.length === 0) return fail('invalid-selection', 'select at least one confirmed reference intent item to materialize');
  if (selectedItemIds.length > MAX_MATERIALIZATION_ITEM_IDS) return fail('invalid-selection', `at most ${MAX_MATERIALIZATION_ITEM_IDS} items can be materialized at once`);
  if (new Set(selectedItemIds).size !== selectedItemIds.length) return fail('invalid-selection', 'selected annotation item ids must be unique');

  const itemsById = new Map(annotation.items.map((item) => [item.annotationItemId, item] as const));
  const selected: { itemId: string; intent: ReferenceIntent }[] = [];
  for (const itemId of selectedItemIds) {
    const item = itemsById.get(itemId);
    if (item === undefined) return fail('invalid-selection', `selected annotation item "${itemId}" does not exist in this annotation`);
    const blocked = referenceMaterializationBlockReason(item);
    if (blocked !== undefined) return fail('invalid-selection', `annotation item "${itemId}" cannot be materialized: ${blocked}`);
    selected.push({ itemId, intent: (item.interpretation as Extract<VisualAnnotationItem['interpretation'], { state: 'confirmed' }>).intent as ReferenceIntent });
  }

  // --- regions: refinements in place, then creates appended in selection order ---
  const sourceRegions: readonly ReferenceRegion[] = sourceReference.regions ?? [];
  const finalRegions: ReferenceRegion[] = sourceRegions.map((region) => ({ id: region.id, rectangle: { ...region.rectangle } }));
  const refinedIndexes = new Set<number>();
  const createdIds = new Set<string>();
  for (const { itemId, intent } of selected) {
    if (intent.kind !== 'reference-region') continue;
    const lowerId = intent.region.id.toLowerCase();
    if (intent.mode === 'refine') {
      const index = sourceRegions.findIndex((region) => region.id.toLowerCase() === lowerId);
      if (index < 0) return fail('invalid-selection', `annotation item "${itemId}" refines region "${intent.region.id}", which does not exist in the source reference`);
      if (refinedIndexes.has(index)) return fail('invalid-selection', `more than one selected item refines region "${intent.region.id}"`);
      refinedIndexes.add(index);
      finalRegions[index] = { id: (sourceRegions[index] as ReferenceRegion).id, rectangle: { ...intent.region.rectangle } };
    }
  }
  for (const { itemId, intent } of selected) {
    if (intent.kind !== 'reference-region' || intent.mode !== 'create') continue;
    const lowerId = intent.region.id.toLowerCase();
    if (sourceRegions.some((region) => region.id.toLowerCase() === lowerId)) return fail('invalid-selection', `annotation item "${itemId}" creates region "${intent.region.id}", which already exists in the source reference`);
    if (createdIds.has(lowerId)) return fail('invalid-selection', `more than one selected item creates region "${intent.region.id}"`);
    createdIds.add(lowerId);
    finalRegions.push({ id: intent.region.id, rectangle: { ...intent.region.rectangle } });
  }
  const regionsValidation = isValidReferenceRegions(finalRegions, image.width, image.height);
  if (!regionsValidation.valid) return fail('invalid-materialized-reference', `resulting regions are invalid: ${regionsValidation.reason}`);

  // --- requirements: source content first, then selected requirements in selection order ---
  const rawRequirements: RawReferenceRequirement[] = (sourceReference.requirements ?? []).map(toRawReferenceRequirement);
  for (const { itemId, intent } of selected) {
    if (intent.kind !== 'reference-requirement') continue;
    const rawValidation = isValidRawReferenceRequirement(intent.requirement);
    if (!rawValidation.valid) return fail('invalid-selection', `annotation item "${itemId}" has an invalid requirement: ${rawValidation.reason}`);
    if (intent.requirement.subject.kind === 'region-relationship') {
      const expectation = deriveReferenceRequirementExpectation(intent.requirement.subject, finalRegions);
      if (!expectation.available || expectation.kind !== 'relationship' || !expectation.matches) {
        return fail('invalid-materialized-reference', `annotation item "${itemId}" requires a region relationship that the resulting region geometry does not exhibit`);
      }
    }
    rawRequirements.push(intent.requirement);
  }
  const builtRequirements = rawRequirements.map((raw) => buildReferenceRequirement(raw));
  const requirementsValidation = isValidReferenceRequirements(builtRequirements, finalRegions);
  if (!requirementsValidation.valid) return fail('invalid-materialized-reference', `resulting requirements are invalid: ${requirementsValidation.reason}`);

  const label = sourceReference.provenance.label;
  const imported = await importExternalReference(options.imageBytes, {
    outputLocation: options.outputLocation,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(label === undefined ? {} : { label }),
    supersedesReferenceRoot: options.sourceReferenceRoot,
    ...(finalRegions.length === 0 ? {} : { regions: finalRegions }),
    ...(rawRequirements.length === 0 ? {} : { requirements: rawRequirements }),
    ...(sourceReference.applicability === undefined ? {} : { applicability: sourceReference.applicability }),
  });
  if (!imported.ok) {
    const first = imported.diagnostics[0];
    const invalidComposition = first !== undefined && ['invalid-reference-region', 'invalid-reference-requirement', 'invalid-reference-applicability'].includes(first.code);
    return fail(invalidComposition ? 'invalid-materialized-reference' : 'persistence-failure', imported.diagnostics.map((d) => d.message).join('; '));
  }

  return {
    ok: true,
    referenceId: imported.referenceId,
    referenceRequestId: imported.referenceRequestId,
    artifactRoot: imported.artifactRoot,
    manifestPath: imported.manifestPath,
    imagePath: imported.imagePath,
    lifecycle: 'imported',
    supersedesReferenceId: sourceReference.referenceId,
    regionCount: imported.regionCount,
    requirementCount: imported.requirementCount,
  };
}
