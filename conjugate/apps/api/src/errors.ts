export type FailureCode = 'CLAUDE_NOT_CONFIGURED' | 'CLAUDE_UNAVAILABLE' | 'CLAUDE_TIMEOUT' | 'CLAUDE_INVALID_OUTPUT' | 'CLAUDE_CONTEXT_LIMIT' | 'CLAUDE_REFUSED' | 'INVALID_REQUEST' | 'UNKNOWN_PRODUCT' | 'RESEARCH_CANCELLED' | 'RESEARCH_SKILL_INVALID';
const messages: Record<FailureCode, string> = {
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
