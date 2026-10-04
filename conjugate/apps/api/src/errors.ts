export type FailureCode = 'CLAUDE_NOT_CONFIGURED' | 'CLAUDE_UNAVAILABLE' | 'CLAUDE_TIMEOUT' | 'CLAUDE_INVALID_OUTPUT' | 'CLAUDE_CONTEXT_LIMIT' | 'CLAUDE_REFUSED' | 'INVALID_REQUEST' | 'UNKNOWN_PRODUCT' | 'RESEARCH_CANCELLED' | 'RESEARCH_SKILL_INVALID' | 'CHAT_BUDGET_EXCEEDED' | 'CHAT_BUSY' | 'MODEL_ARTIFACT_INVALID' | 'MODEL_REPLAY_REJECTED' | 'INFERENCE_NOT_CONFIGURED' | 'INFERENCE_UNAVAILABLE' | 'INFERENCE_TIMEOUT' | 'INFERENCE_INVALID_OUTPUT' | 'INFERENCE_BUDGET_EXCEEDED' | 'INFERENCE_BUSY';
const messages: Record<FailureCode, string> = {
  INFERENCE_NOT_CONFIGURED: 'Live inference is off on this server. Nothing was sent.',
  INFERENCE_UNAVAILABLE: 'HF inference failed. No saved result replaced it.',
  INFERENCE_TIMEOUT: 'Inference timed out. No saved result replaced it.',
  INFERENCE_INVALID_OUTPUT: 'Inference output failed validation. No score was released.',
  INFERENCE_BUDGET_EXCEEDED: 'This server reached its inference call limit. Nothing was sent.',
  INFERENCE_BUSY: 'An inference request is already running. Try after it finishes.',
  MODEL_ARTIFACT_INVALID: 'Model observations could not be verified. No score was returned.',
  MODEL_REPLAY_REJECTED: 'Saved model observations do not match this build.',
  CHAT_BUDGET_EXCEEDED: 'The chat reached its call limit. No answer was released. Nothing switched to rules only.',
  CHAT_BUSY: 'Two chat questions are already running on this server. Try again after one finishes.',
  CLAUDE_NOT_CONFIGURED: 'No ANTHROPIC_API_KEY on the server, so Claude is off. Pick rules only. Nothing was run.',
  CLAUDE_UNAVAILABLE: 'The Claude API call failed. The run is blocked and did not switch to rules only.',
  CLAUDE_TIMEOUT: 'The Claude API call timed out. The run is blocked and did not switch to rules only.',
  CLAUDE_INVALID_OUTPUT: 'Claude returned ids that do not fit the schema. The run is blocked and did not switch to rules only.',
  CLAUDE_CONTEXT_LIMIT: 'The model request exceeded the local size limit. Nothing was sent for that call.',
  CLAUDE_REFUSED: 'The Claude API stopped this request with a refusal before returning any ids. The run is blocked and did not switch to rules only. Run it again or use rules only.',
  INVALID_REQUEST: 'The request does not match the API schema. Check the fields and the synthetic-use confirmation.',
  UNKNOWN_PRODUCT: 'That product id is not on the allowlist.',
  RESEARCH_CANCELLED: 'The run was cancelled. No result was returned.',
  RESEARCH_SKILL_INVALID: 'A required local prompt file is missing, too large or has the wrong format. No model call was made and the run did not switch to rules only.'
};
export class ApiFailure extends Error {
  readonly code: FailureCode;
  readonly status: number;
  constructor(code: FailureCode, status: number) {
    super(messages[code]);
    this.name = 'ApiFailure';
    this.code = code;
    this.status = status;
  }
}
