/** Type-only re-exports of the canonical frontend-contract/evaluation domain types (erased at build time - see viewer/src/types/observation.ts for the same pattern). */
export type {
  PersistentBaselineContract,
  PerChangeContract,
  BaselineClause,
  PerChangeClause,
  FrontendContractClauseBase,
  ContractPrimitive,
  AuthoredChangeScopeCategory,
  ExpectedDependentMode,
  ClauseEvaluationResult,
  ClauseResultStatus,
  OverallVerdict,
} from '../../../src/domain/frontendContracts.js';

export type { FrontendContractEvaluationArtifact } from '../../../src/domain/frontendContractEvaluationArtifact.js';
export type { UnexpectedChangeResult } from '../../../src/domain/frontendContractEvaluation.js';

export type { LinkStatus } from '../../../src/viewerServer/evidence/linkedEvidence.js';
