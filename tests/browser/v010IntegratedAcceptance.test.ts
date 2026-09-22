/**
 * Batch 8's single v0.10 integration entrypoint. Each imported ACCEPTANCE GATE
 * owns fresh disposable project, server, browser, and cleanup state. Keeping
 * the proven entry/correction/fidelity gates as their canonical owners avoids
 * introducing a second test-only workflow implementation.
 */
import './runtimeAnnotationContractPromotion.test.js';
import './referenceAnnotationMaterialization.test.js';
import './visualChangeCorrectionAcceptance.test.js';
import './referenceCorrectionWorkflow.test.js';
import './visualChangeWorkspace.test.js';
