import { useEffect, useState } from 'react';
import type { ReferenceRegion, ReferenceRegionRelationship } from '../types/reference.js';
import type { VisualAnnotationItem } from '../types/visualAnnotation.js';
import type { AuthoringSessionState } from '../hooks/useAuthoringSession.js';
import type { SourceAnnotationsState } from '../hooks/useRuntimeAnnotations.js';
import type { AnnotationDraft } from '../hooks/useRuntimeAnnotationDraft.js';
import type { ReferenceMaterializationState } from '../hooks/useAnnotationReferenceMaterialization.js';
import { ANNOTATION_NOTE_MAX_LENGTH } from '../annotation/annotationGeometry.js';
import {
  EMPTY_REQUIREMENT_FORM,
  EXPECTED_DEPENDENT_MODES,
  REGION_MEASUREMENTS,
  REGION_PROPERTIES,
  REQUIREMENT_CATEGORIES,
  TOLERANCE_KINDS,
  buildRequirementFromForm,
  candidateRegionSummary,
  isReferenceMaterializationListItem,
  referenceMaterializationStatus,
  regionCreateBlockedReason,
  regionIntentOf,
  requirementRegionIds,
  withAssetSensitiveCandidate,
  withInformationalCandidate,
  withRegionCreateCandidate,
  withRegionRefineCandidate,
  withRequirementCandidate,
} from '../annotation/referenceIntent.js';
import type { RequirementForm } from '../annotation/referenceIntent.js';
import { AnnotationSessionNotice, DraftLifecycleSection, SavedAnnotationList } from './AnnotationPanelSections.js';

export function describeReferenceAssociation(association: VisualAnnotationItem['association']): string {
  if (association === undefined) return 'No association';
  switch (association.kind) {
    case 'reference-region':
      return `Region association: ${association.regionId}`;
    case 'reference-relationship':
      return `Region relationship association: ${association.relationship} (${association.subjectRegion} → ${association.relatedRegion})`;
    default:
      return 'Unsupported association for reference evidence';
  }
}

function relationshipLabel(relationship: ReferenceRegionRelationship): string {
  return `${relationship.subjectRegion} ${relationship.kind} ${relationship.relatedRegion}`;
}

function interpretationLabel(item: VisualAnnotationItem): string {
  const { interpretation } = item;
  if (interpretation.state === 'uninterpreted') return 'Interpretation: uninterpreted';
  if (interpretation.state === 'candidate') return `Interpretation: candidate ${interpretation.intent.kind}`;
  return `Interpretation: confirmed ${interpretation.intent.kind} at ${interpretation.confirmedAt}`;
}

function materializationItemLabel(item: VisualAnnotationItem): string {
  const { interpretation } = item;
  if (interpretation.state === 'uninterpreted') return 'no intent';
  const { intent } = interpretation;
  switch (intent.kind) {
    case 'reference-region':
      return `region ${intent.mode} ${intent.region.id} (x ${intent.region.rectangle.x}, y ${intent.region.rectangle.y}, width ${intent.region.rectangle.width}, height ${intent.region.rectangle.height})`;
    case 'reference-requirement':
      return `requirement ${JSON.stringify(intent.requirement)}`;
    default:
      return intent.kind;
  }
}

/**
 * v0.9 Batch 6: explicit selection of confirmed reference-region and
 * reference-requirement intent from the saved annotation for materialization
 * into a new imported reference revision. Candidate and informational items
 * are never selectable. Nothing here composes the final region or requirement
 * sets, approves anything, or switches the viewed reference.
 */
function ReferenceMaterializationSection({
  draft,
  materialization,
  mutationBlocked,
  onMaterialize,
  onSelectionChange,
}: {
  draft: AnnotationDraft;
  materialization: ReferenceMaterializationState;
  mutationBlocked: boolean;
  onMaterialize: (itemIds: string[]) => void;
  onSelectionChange: (itemIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedIds([]);
  }, [draft.parentAnnotationHandle]);
  // A successful materialization clears the selection, so the same items are never materialized again by accident.
  const materializedReferenceId = materialization.state === 'materialized' ? materialization.referenceId : undefined;
  useEffect(() => {
    if (materializedReferenceId !== undefined) setSelectedIds([]);
  }, [materializedReferenceId]);

  const saved = draft.parentAnnotationHandle !== undefined && !draft.dirty;
  const listItems = draft.items.filter(isReferenceMaterializationListItem);
  const materializableIds = new Set(listItems.filter((item) => referenceMaterializationStatus(item).materializable).map((item) => item.annotationItemId));
  const effectiveSelection = selectedIds.filter((id) => materializableIds.has(id));
  useEffect(() => onSelectionChange(effectiveSelection), [effectiveSelection.join('|'), onSelectionChange]);
  const canMaterialize = saved && effectiveSelection.length > 0 && materialization.state !== 'materializing' && !mutationBlocked;

  return (
    <div className="annotation-panel__promotion annotation-panel__materialization">
      <h4>Confirmed reference intent</h4>
      {!saved ? (
        <p className="annotation-panel__hint" data-materialization-blocked="true">
          Save the annotation before materializing reference intent.
        </p>
      ) : listItems.length === 0 ? (
        <p className="placeholder-note">No reference intent in this saved annotation.</p>
      ) : (
        <ul className="annotation-panel__proposal-list">
          {listItems.map((item) => {
            const status = referenceMaterializationStatus(item);
            return (
              <li key={item.annotationItemId} data-materialization-item-id={item.annotationItemId} data-materializable={status.materializable ? 'true' : 'false'}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Materialize annotation item ${item.annotationItemId}`}
                    disabled={!status.materializable}
                    checked={effectiveSelection.includes(item.annotationItemId)}
                    onChange={(e) => {
                      const { checked } = e.target;
                      setSelectedIds((current) => (checked ? [...current.filter((id) => id !== item.annotationItemId), item.annotationItemId] : current.filter((id) => id !== item.annotationItemId)));
                    }}
                  />
                  {materializationItemLabel(item)} ({item.interpretation.state})
                </label>
                {status.materializable ? null : <span className="annotation-panel__hint"> {status.reason}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="placeholder-note" data-materialization-warning="true">
        This creates a new imported reference revision. The current reference remains unchanged. The new reference is not approved automatically.
      </p>
      <button type="button" disabled={!canMaterialize} onClick={() => onMaterialize(effectiveSelection)}>
        Materialize selected into new reference revision
      </button>
      {materialization.state === 'materializing' ? (
        <p className="annotation-panel__status" role="status">
          Materializing…
        </p>
      ) : null}
      {materialization.state === 'materialized' ? (
        <div
          className="annotation-panel__status annotation-panel__status--success"
          role="status"
          data-materialized-reference-id={materialization.referenceId}
          data-materialized-lifecycle="imported"
          data-supersedes-reference-id={materialization.supersedesReferenceId}
        >
          <p>New reference ID: {materialization.referenceId}</p>
          <p>Lifecycle: imported</p>
          <p>Supersedes: {materialization.supersedesReferenceId}</p>
          <p>
            Regions: {materialization.regionCount} · Requirements: {materialization.requirementCount}
          </p>
          <p>Approval required: {materialization.approvalRequired ? 'yes' : 'no'}</p>
          <p>The new reference is imported but not approved. Use the existing explicit approval workflow when ready.</p>
        </div>
      ) : null}
      {materialization.state === 'failed' ? (
        <p className="annotation-panel__error" role="alert" data-materialization-status-code={materialization.status ?? 'network'}>
          {materialization.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * v0.9 Batch 4 external-reference annotation panel. Shares the saved list and
 * draft lifecycle with the runtime panel, and adds explicit reference-side
 * actions for the selected draft item: region/relationship association,
 * candidate region create/refine, informational and asset-sensitive intent,
 * candidate reference requirements, and explicit confirmation. The exact
 * candidate structure is always shown before confirmation. Nothing here
 * changes the source reference. v0.9 Batch 6 adds explicit materialization of
 * selected confirmed items of a saved annotation into a new imported
 * reference revision through the server's canonical use case.
 */
export function ReferenceAnnotationPanel({
  session,
  saved,
  draft,
  sourceRegions,
  relationships,
  selectedRegionId,
  onLoadSaved,
  onNewAnnotation,
  onUpdateSelectedItem,
  onConfirmSelected,
  onDeleteSelected,
  onCancelChanges,
  onSave,
  materialization,
  materializationBlocked,
  onMaterialize,
  onIntentSelectionChange,
}: {
  session: AuthoringSessionState;
  saved: SourceAnnotationsState;
  draft: AnnotationDraft;
  sourceRegions: readonly ReferenceRegion[];
  relationships: readonly ReferenceRegionRelationship[];
  selectedRegionId: string | undefined;
  onLoadSaved: (handle: string) => void;
  onNewAnnotation: () => void;
  onUpdateSelectedItem: (update: (item: VisualAnnotationItem) => VisualAnnotationItem) => void;
  onConfirmSelected: () => void;
  onDeleteSelected: () => void;
  onCancelChanges: () => void;
  onSave: () => void;
  /** v0.9 Batch 6: materialization state for the currently loaded saved annotation. */
  materialization: ReferenceMaterializationState;
  materializationBlocked: boolean;
  onMaterialize: (itemIds: string[]) => void;
  onIntentSelectionChange: (itemIds: string[]) => void;
}) {
  const [associationRelationshipIndex, setAssociationRelationshipIndex] = useState('');
  const [proposedRegionId, setProposedRegionId] = useState('');
  const [form, setForm] = useState<RequirementForm>(EMPTY_REQUIREMENT_FORM);

  const editable = session.state === 'available';
  const selectedItem = draft.items.find((item) => item.annotationItemId === draft.selectedItemId);
  const hasEmptyNote = draft.items.some((item) => item.mark.kind === 'note' && item.mark.text.length === 0);
  const canSave = editable && draft.dirty && !hasEmptyNote && draft.save.state !== 'saving';
  const summary = candidateRegionSummary(sourceRegions, draft.items);
  const knownRegionIds = requirementRegionIds(sourceRegions, draft.items);
  const requirement = buildRequirementFromForm(form, knownRegionIds, relationships);
  const createBlocked = selectedItem === undefined ? undefined : regionCreateBlockedReason(proposedRegionId, sourceRegions, draft.items, selectedItem.annotationItemId);
  const associationRelationship = associationRelationshipIndex === '' ? undefined : relationships[Number(associationRelationshipIndex)];

  const regionProposals = draft.items.flatMap((item) => {
    const intent = regionIntentOf(item);
    return intent === undefined ? [] : [{ item, intent }];
  });
  const requirementProposals = draft.items.flatMap((item) =>
    item.interpretation.state !== 'uninterpreted' && item.interpretation.intent.kind === 'reference-requirement' ? [{ item, requirement: item.interpretation.intent.requirement }] : [],
  );

  function setField<K extends keyof RequirementForm>(key: K, value: RequirementForm[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="annotation-panel annotation-panel--reference" aria-label="Reference annotations">
      <h3 className="annotation-panel__title">Reference annotations</h3>

      <AnnotationSessionNotice session={session} />
      <SavedAnnotationList saved={saved} activeHandle={draft.parentAnnotationHandle} sourceLabel="reference" onLoadSaved={onLoadSaved} />
      <DraftLifecycleSection
        draft={draft}
        editable={editable}
        canSave={canSave}
        hasEmptyNote={hasEmptyNote}
        onNewAnnotation={onNewAnnotation}
        onCancelChanges={onCancelChanges}
        onSave={onSave}
      />

      <div className="annotation-panel__candidates" data-source-regions={summary.sourceRegions} data-candidate-creates={summary.candidateCreates} data-candidate-refinements={summary.candidateRefinements}>
        <p className="annotation-panel__candidate-summary">
          Existing source regions: {summary.sourceRegions} · Candidate creates: {summary.candidateCreates} · Candidate refinements: {summary.candidateRefinements}
        </p>
        <p className="placeholder-note">Candidate proposals live only in this annotation. They are not the final reference region set and do not change the source reference.</p>
        <h4>Candidate annotation region proposals</h4>
        {regionProposals.length === 0 ? (
          <p className="placeholder-note">None.</p>
        ) : (
          <ul className="annotation-panel__proposal-list">
            {regionProposals.map(({ item, intent }) => (
              <li key={item.annotationItemId} data-proposal-region-id={intent.region.id} data-proposal-state={item.interpretation.state}>
                {intent.mode} {intent.region.id} ({item.interpretation.state}): x {intent.region.rectangle.x}, y {intent.region.rectangle.y}, width {intent.region.rectangle.width}, height {intent.region.rectangle.height}
              </li>
            ))}
          </ul>
        )}
        <h4>Candidate annotation requirements</h4>
        {requirementProposals.length === 0 ? (
          <p className="placeholder-note">None. Source requirements are shown separately in the reference inspector.</p>
        ) : (
          <ul className="annotation-panel__proposal-list">
            {requirementProposals.map(({ item, requirement: proposal }) => (
              <li key={item.annotationItemId} data-proposal-state={item.interpretation.state}>
                <code>{JSON.stringify(proposal)}</code> ({item.interpretation.state})
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedItem === undefined ? null : (
        <div className="annotation-panel__item" data-selected-annotation-item-id={selectedItem.annotationItemId}>
          <h4>Selected {selectedItem.mark.kind}</h4>
          <p className="annotation-panel__association" data-association-kind={selectedItem.association?.kind ?? 'none'}>
            {describeReferenceAssociation(selectedItem.association)}
          </p>
          <p className="annotation-panel__interpretation" data-interpretation-state={selectedItem.interpretation.state}>
            {interpretationLabel(selectedItem)}
          </p>
          {selectedItem.interpretation.state === 'uninterpreted' ? null : (
            <pre className="annotation-panel__intent" data-candidate-intent="true" aria-label="Structured reference intent">
              {JSON.stringify(selectedItem.interpretation.intent, null, 2)}
            </pre>
          )}

          {editable && selectedItem.mark.kind === 'note' ? (
            <label className="annotation-panel__note-editor">
              Note text
              <textarea
                value={selectedItem.mark.text}
                maxLength={ANNOTATION_NOTE_MAX_LENGTH}
                aria-label="Selected note text"
                onChange={(e) => {
                  const text = e.target.value.slice(0, ANNOTATION_NOTE_MAX_LENGTH);
                  onUpdateSelectedItem((item) => (item.mark.kind === 'note' ? { ...item, mark: { ...item.mark, text } } : item));
                }}
              />
            </label>
          ) : null}

          {editable ? (
            <>
              <fieldset className="annotation-panel__group">
                <legend>Association</legend>
                <div className="annotation-panel__association-actions">
                  <button
                    type="button"
                    disabled={selectedRegionId === undefined}
                    onClick={() => {
                      if (selectedRegionId !== undefined) onUpdateSelectedItem((item) => ({ ...item, association: { kind: 'reference-region', regionId: selectedRegionId } }));
                    }}
                  >
                    Associate region{selectedRegionId === undefined ? '' : ` ${selectedRegionId}`}
                  </button>
                  <label>
                    Region relationship
                    <select value={associationRelationshipIndex} onChange={(e) => setAssociationRelationshipIndex(e.target.value)} aria-label="Canonical region relationship to associate">
                      <option value="">Choose a relationship…</option>
                      {relationships.map((relationship, index) => (
                        <option key={index} value={String(index)}>
                          {relationshipLabel(relationship)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={associationRelationship === undefined}
                    onClick={() => {
                      if (associationRelationship === undefined) return;
                      onUpdateSelectedItem((item) => ({
                        ...item,
                        association: { kind: 'reference-relationship', subjectRegion: associationRelationship.subjectRegion, relatedRegion: associationRelationship.relatedRegion, relationship: associationRelationship.kind },
                      }));
                    }}
                  >
                    Associate relationship
                  </button>
                  <button
                    type="button"
                    disabled={selectedItem.association === undefined}
                    onClick={() =>
                      onUpdateSelectedItem((item) => {
                        const { association: _removed, ...rest } = item;
                        void _removed;
                        return rest;
                      })
                    }
                  >
                    Clear association
                  </button>
                </div>
              </fieldset>

              <fieldset className="annotation-panel__group">
                <legend>Informational intent</legend>
                <div className="annotation-panel__association-actions">
                  <button type="button" onClick={() => onUpdateSelectedItem(withInformationalCandidate)}>
                    Mark informational
                  </button>
                  <button type="button" onClick={() => onUpdateSelectedItem((item) => withAssetSensitiveCandidate(item))}>
                    Mark asset-sensitive
                  </button>
                  <button
                    type="button"
                    disabled={selectedRegionId === undefined}
                    onClick={() => {
                      if (selectedRegionId !== undefined) onUpdateSelectedItem((item) => withAssetSensitiveCandidate(item, selectedRegionId));
                    }}
                  >
                    Mark asset-sensitive for region{selectedRegionId === undefined ? '' : ` ${selectedRegionId}`}
                  </button>
                </div>
              </fieldset>

              <fieldset className="annotation-panel__group">
                <legend>Candidate region (rectangles only)</legend>
                {selectedItem.mark.kind !== 'rectangle' ? (
                  <p className="placeholder-note">Only a rectangle annotation can propose or refine a region.</p>
                ) : (
                  <div className="annotation-panel__association-actions">
                    <label>
                      Proposed region ID
                      <input aria-label="Proposed region ID" type="text" value={proposedRegionId} maxLength={64} onChange={(e) => setProposedRegionId(e.target.value)} aria-describedby="proposed-region-id-hint" />
                    </label>
                    <span id="proposed-region-id-hint" className="placeholder-note">
                      Letters, digits, underscore, hyphen (up to 64).
                    </span>
                    <button
                      type="button"
                      disabled={createBlocked !== undefined}
                      onClick={() => {
                        onUpdateSelectedItem((item) => withRegionCreateCandidate(item, proposedRegionId) ?? item);
                      }}
                    >
                      Create candidate region
                    </button>
                    {createBlocked === undefined ? null : <span className="annotation-panel__hint">{createBlocked}</span>}
                    <button
                      type="button"
                      disabled={selectedRegionId === undefined}
                      onClick={() => {
                        if (selectedRegionId !== undefined) onUpdateSelectedItem((item) => withRegionRefineCandidate(item, selectedRegionId) ?? item);
                      }}
                    >
                      Refine selected region{selectedRegionId === undefined ? '' : ` ${selectedRegionId}`}
                    </button>
                  </div>
                )}
              </fieldset>

              <fieldset className="annotation-panel__group">
                <legend>Candidate requirement</legend>
                <div className="annotation-panel__requirement-form">
                  <label>
                    Requirement category
                    <select aria-label="Requirement category" value={form.category} onChange={(e) => setField('category', e.target.value as RequirementForm['category'])}>
                      <option value="">Choose…</option>
                      {REQUIREMENT_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  {form.category === 'expected-dependent' ? (
                    <label>
                      Expected-dependent mode
                      <select aria-label="Expected-dependent mode" value={form.expectedDependentMode} onChange={(e) => setField('expectedDependentMode', e.target.value as RequirementForm['expectedDependentMode'])}>
                        <option value="">Choose…</option>
                        {EXPECTED_DEPENDENT_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label>
                    Requirement subject
                    <select aria-label="Requirement subject" value={form.subjectKind} onChange={(e) => setField('subjectKind', e.target.value as RequirementForm['subjectKind'])}>
                      <option value="">Choose…</option>
                      <option value="region-property">region-property</option>
                      <option value="region-relationship">region-relationship</option>
                      <option value="region-measurement">region-measurement</option>
                    </select>
                  </label>
                  {form.subjectKind === 'region-property' ? (
                    <>
                      <label>
                        Requirement region
                        <select aria-label="Requirement region" value={form.region} onChange={(e) => setField('region', e.target.value)}>
                          <option value="">Choose…</option>
                          {knownRegionIds.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Region property
                        <select aria-label="Region property" value={form.property} onChange={(e) => setField('property', e.target.value as RequirementForm['property'])}>
                          <option value="">Choose…</option>
                          {REGION_PROPERTIES.map((property) => (
                            <option key={property} value={property}>
                              {property}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : null}
                  {form.subjectKind === 'region-relationship' ? (
                    <label>
                      Requirement relationship
                      <select aria-label="Requirement relationship" value={form.relationshipIndex} onChange={(e) => setField('relationshipIndex', e.target.value)}>
                        <option value="">Choose a canonical relationship…</option>
                        {relationships.map((relationship, index) => (
                          <option key={index} value={String(index)}>
                            {relationshipLabel(relationship)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {form.subjectKind === 'region-measurement' ? (
                    <>
                      <label>
                        Subject region
                        <select aria-label="Subject region" value={form.subjectRegion} onChange={(e) => setField('subjectRegion', e.target.value)}>
                          <option value="">Choose…</option>
                          {knownRegionIds.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Related region
                        <select aria-label="Related region" value={form.relatedRegion} onChange={(e) => setField('relatedRegion', e.target.value)}>
                          <option value="">Choose…</option>
                          {knownRegionIds.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Measurement
                        <select aria-label="Measurement" value={form.measurement} onChange={(e) => setField('measurement', e.target.value as RequirementForm['measurement'])}>
                          <option value="">Choose…</option>
                          {REGION_MEASUREMENTS.map((measurement) => (
                            <option key={measurement} value={measurement}>
                              {measurement}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : null}
                  {form.subjectKind === 'region-property' || form.subjectKind === 'region-measurement' ? (
                    <>
                      <label>
                        Tolerance
                        <select aria-label="Tolerance" value={form.toleranceKind} onChange={(e) => setField('toleranceKind', e.target.value as RequirementForm['toleranceKind'])}>
                          <option value="">Choose…</option>
                          {TOLERANCE_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {kind === 'absolute-reference-px' ? 'absolute-reference-px (reference-image pixels)' : kind}
                            </option>
                          ))}
                        </select>
                      </label>
                      {form.toleranceKind === 'absolute-reference-px' || form.toleranceKind === 'percent' ? (
                        <label>
                          Tolerance amount
                          <input aria-label="Tolerance amount" type="number" min={0} max={100} step="any" value={form.toleranceAmount} onChange={(e) => setField('toleranceAmount', e.target.value)} />
                        </label>
                      ) : null}
                    </>
                  ) : null}
                  <button
                    type="button"
                    disabled={!requirement.ok}
                    onClick={() => {
                      if (requirement.ok) onUpdateSelectedItem((item) => withRequirementCandidate(item, requirement.requirement));
                    }}
                  >
                    Set candidate requirement
                  </button>
                  {requirement.ok ? null : <span className="annotation-panel__hint">{requirement.reason}</span>}
                </div>
              </fieldset>

              <div className="annotation-panel__association-actions">
                <button type="button" disabled={selectedItem.interpretation.state !== 'candidate'} onClick={onConfirmSelected}>
                  Confirm reference intent
                </button>
                <button type="button" className="annotation-panel__delete" onClick={onDeleteSelected}>
                  Delete draft item
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {editable ? <ReferenceMaterializationSection draft={draft} materialization={materialization} mutationBlocked={materializationBlocked} onMaterialize={onMaterialize} onSelectionChange={onIntentSelectionChange} /> : null}
    </section>
  );
}
