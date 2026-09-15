import path from 'node:path';
import { readProjectConfig } from '../projectWorkflow/projectConfig.js';
import type { FrontendObserverAcceptanceConfig } from '../projectWorkflow/projectConfig.js';
import { aliasCatalogPath, projectConfigPath, projectEvidenceRoot } from '../projectWorkflow/projectPaths.js';
import { readAliasCatalog } from '../projectWorkflow/aliasCatalog.js';
import { loadBindingsFile, loadComparisonConfigFile, resolveContainedAcceptancePath } from '../projectWorkflow/checkAcceptance.js';
import { readObservationArtifact } from '../artifacts/artifactReader.js';
import { readFrontendContractEvaluationArtifact } from '../artifacts/frontendContractEvaluationArtifactReader.js';
import { readPersistentBaselineContract, readPerChangeContract } from '../artifacts/frontendContractArtifactReader.js';
import { readExternalReferenceArtifact } from '../artifacts/externalReferenceArtifactReader.js';
import { compareAndPersistFromArtifactRoots } from './comparisonService.js';
import { evaluateAndPersistFromArtifactRoots } from './frontendContractEvaluationService.js';
import { evaluateReferenceCandidateFidelityFromArtifactRoots } from './referenceFidelityEvaluationService.js';
import { captureCurrentObservation } from './projectWorkflowService.js';
import {
  emptyCheckResult,
  finalizeCheckStatus,
  projectContractResult,
  projectReferenceResult,
  type CheckWorkflowResult,
} from '../projectWorkflow/checkResult.js';
import type { ComparisonConfig } from '../domain/comparison.js';
import type { PersistentBaselineContract, PerChangeContract } from '../domain/frontendContracts.js';
import type { ReferenceRuntimeBindingDeclaration } from '../domain/externalReferenceRuntimeBinding.js';

function projectRelative(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/');
}

function addBlocker(result: CheckWorkflowResult, code: string, message: string): void {
  result.blockers.push({ code, message });
}

interface PreparedAcceptance {
  comparisonConfig?: ComparisonConfig;
  contract?: { baselineRoot: string; changeRoot: string; baseline: PersistentBaselineContract; change: PerChangeContract };
  reference?: { root: string; bindings: ReferenceRuntimeBindingDeclaration[] };
}

async function prepareAcceptance(projectRoot: string, config: FrontendObserverAcceptanceConfig): Promise<{ ok: true; value: PreparedAcceptance } | { ok: false; code: string; message: string }> {
  const prepared: PreparedAcceptance = {};
  if (config.comparisonConfigFile !== undefined) {
    const resolved = resolveContainedAcceptancePath(projectRoot, config.comparisonConfigFile);
    if (!resolved.ok) return { ok: false, code: 'acceptance-config-invalid', message: resolved.error };
    const loaded = loadComparisonConfigFile(resolved.path);
    if (!loaded.ok) return { ok: false, code: 'acceptance-config-invalid', message: loaded.error };
    prepared.comparisonConfig = loaded.config;
  }
  if (config.contract !== undefined) {
    const baselineRoot = resolveContainedAcceptancePath(projectRoot, config.contract.baselineArtifact);
    const changeRoot = resolveContainedAcceptancePath(projectRoot, config.contract.changeArtifact);
    if (!baselineRoot.ok || !changeRoot.ok) return { ok: false, code: 'acceptance-config-invalid', message: 'configured contract artifact path is invalid or outside the project' };
    const baseline = await readPersistentBaselineContract(path.join(baselineRoot.path, 'manifest.json'));
    const change = await readPerChangeContract(path.join(changeRoot.path, 'manifest.json'));
    if (!baseline.ok || !change.ok) return { ok: false, code: 'acceptance-config-invalid', message: 'configured contract artifact is invalid' };
    prepared.contract = { baselineRoot: baselineRoot.path, changeRoot: changeRoot.path, baseline: baseline.contract, change: change.contract };
  }
  if (config.reference !== undefined) {
    const referenceRoot = resolveContainedAcceptancePath(projectRoot, config.reference.approvedArtifact);
    if (!referenceRoot.ok) return { ok: false, code: 'acceptance-config-invalid', message: referenceRoot.error };
    const reference = await readExternalReferenceArtifact(path.join(referenceRoot.path, 'manifest.json'));
    if (!reference.ok) return { ok: false, code: 'acceptance-config-invalid', message: 'configured reference artifact is invalid' };
    if (reference.artifact.lifecycle.state !== 'approved') return { ok: false, code: 'reference-not-approved', message: 'configured reference is not approved' };
    let bindings: unknown = [];
    if (config.reference.bindingsFile !== undefined) {
      const bindingsPath = resolveContainedAcceptancePath(projectRoot, config.reference.bindingsFile);
      if (!bindingsPath.ok) return { ok: false, code: 'acceptance-config-invalid', message: bindingsPath.error };
      const loaded = loadBindingsFile(bindingsPath.path);
      if (!loaded.ok) return { ok: false, code: 'acceptance-config-invalid', message: loaded.error };
      bindings = loaded.bindings;
    }
    prepared.reference = { root: referenceRoot.path, bindings: bindings as ReferenceRuntimeBindingDeclaration[] };
  }
  return { ok: true, value: prepared };
}

/** Compose existing canonical capture/comparison/contract/reference owners into one project workflow. */
export async function checkProject(projectRoot: string, requestedBaseline?: string): Promise<CheckWorkflowResult> {
  const result = emptyCheckResult();
  const configRead = await readProjectConfig(projectConfigPath(projectRoot));
  if (!configRead.ok) {
    addBlocker(result, 'acceptance-config-invalid', 'project configuration is invalid');
    return finalizeCheckStatus(result);
  }
  const config = configRead.config;
  result.contract.configured = config.acceptance?.contract !== undefined;
  result.contract.state = result.contract.configured ? 'NOT_RUN' : 'NOT_CONFIGURED';
  result.reference.configured = config.acceptance?.reference !== undefined;
  result.reference.state = result.reference.configured ? 'NOT_RUN' : 'NOT_CONFIGURED';

  const catalogRead = await readAliasCatalog(aliasCatalogPath(projectRoot));
  if (!catalogRead.ok) {
    addBlocker(result, 'baseline-artifact-invalid', 'project alias catalog is invalid');
    return finalizeCheckStatus(result);
  }
  const baselineAlias = requestedBaseline ?? config.defaultBaseline;
  const baselineRecord = catalogRead.catalog.observations[baselineAlias];
  if (baselineRecord === undefined) {
    addBlocker(result, 'baseline-alias-not-found', `baseline alias "${baselineAlias}" was not found`);
    return finalizeCheckStatus(result);
  }
  const evidenceRoot = projectEvidenceRoot(projectRoot);
  const baselineRoot = path.join(evidenceRoot, ...baselineRecord.relativeArtifactDir.split('/'));
  const baselineRead = await readObservationArtifact(path.join(baselineRoot, 'manifest.json'));
  if (!baselineRead.ok || baselineRead.artifact.observationId !== baselineRecord.observationId || baselineRead.artifact.requestId !== baselineRecord.requestId) {
    addBlocker(result, 'baseline-artifact-invalid', 'baseline alias does not resolve to the declared canonical observation identity');
    return finalizeCheckStatus(result);
  }
  result.baseline = { alias: baselineAlias, observationId: baselineRecord.observationId, requestId: baselineRecord.requestId, artifactPath: projectRelative(projectRoot, baselineRoot) };

  const acceptance = config.acceptance === undefined ? { ok: true as const, value: {} } : await prepareAcceptance(projectRoot, config.acceptance);
  if (!acceptance.ok) {
    addBlocker(result, acceptance.code, acceptance.message);
    if (acceptance.code === 'reference-not-approved') result.reference.state = 'BLOCKED';
    return finalizeCheckStatus(result);
  }

  const captured = await captureCurrentObservation(projectRoot);
  if (!captured.ok) {
    addBlocker(result, 'candidate-capture-failed', 'current candidate capture failed; the previous current alias was preserved');
    return finalizeCheckStatus(result);
  }
  result.candidate = { alias: 'current', observationId: captured.observationId, requestId: captured.requestId, artifactPath: projectRelative(projectRoot, captured.artifactRoot) };

  const compared = await compareAndPersistFromArtifactRoots(baselineRoot, captured.artifactRoot, {
    ...(acceptance.value.comparisonConfig === undefined ? {} : { config: acceptance.value.comparisonConfig }),
    outputLocation: `.frontend-observer/evidence/comparisons/${baselineAlias}-vs-current`,
    cwd: projectRoot,
  });
  if (!compared.ok) {
    result.comparison = { state: 'BLOCKED' };
    addBlocker(result, 'comparison-failed', 'canonical comparison could not be constructed');
  } else {
    result.comparison = {
      state: compared.comparability,
      comparisonId: compared.comparisonId,
      artifactPath: projectRelative(projectRoot, compared.artifactRoot),
      differenceCount: compared.differenceCount,
      relationshipChangeCount: compared.relationshipChangeCount,
      diagnosticsCount: compared.diagnosticsCount,
    };
    if (compared.comparability === 'incomparable') addBlocker(result, 'comparison-incomparable', 'canonical comparison is incomparable');

    if (acceptance.value.contract !== undefined && compared.comparability !== 'incomparable') {
      const contract = acceptance.value.contract;
      const evaluated = await evaluateAndPersistFromArtifactRoots(
        baselineRoot,
        captured.artifactRoot,
        compared.artifactRoot,
        contract.baselineRoot,
        contract.changeRoot,
        { outputLocation: `.frontend-observer/evidence/evaluations/${baselineAlias}-vs-current`, cwd: projectRoot },
      );
      if (!evaluated.ok) {
        result.contract.state = 'BLOCKED';
        addBlocker(result, 'contract-evaluation-failed', 'canonical frontend-contract evaluation could not be constructed');
      } else {
        const persisted = await readFrontendContractEvaluationArtifact(evaluated.manifestPath);
        if (!persisted.ok) {
          result.contract.state = 'BLOCKED';
          addBlocker(result, 'contract-evaluation-failed', 'persisted frontend-contract evaluation is invalid');
        } else {
          result.contract = projectContractResult(
            persisted.artifact,
            contract.baseline.clauses,
            contract.change.clauses,
            projectRelative(projectRoot, evaluated.artifactRoot),
          );
          if (result.contract.state === 'BLOCKED') addBlocker(result, 'contract-evidence-unavailable', 'contract evidence is unavailable or conflicting');
        }
      }
    }
  }

  if (acceptance.value.reference !== undefined) {
    const reference = acceptance.value.reference;
    const evaluated = await evaluateReferenceCandidateFidelityFromArtifactRoots(reference.root, captured.artifactRoot, reference.bindings);
    if (!evaluated.ok) {
      result.reference.state = 'BLOCKED';
      addBlocker(result, 'reference-evaluation-failed', 'canonical reference-fidelity evaluation could not be constructed');
    } else {
      result.reference = projectReferenceResult(evaluated.evaluation);
      if (evaluated.evaluation.state === 'not-evaluated') addBlocker(result, 'reference-not-evaluated', 'reference fidelity was not evaluated');
      else if (result.reference.unavailableRequirements.length > 0) addBlocker(result, 'reference-evidence-unavailable', 'required reference evidence is unavailable');
    }
  }

  return finalizeCheckStatus(result);
}
