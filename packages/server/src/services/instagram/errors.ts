export type CaptureErrorCode =
  | 'invalid_configuration'
  | 'provider_unavailable'
  | 'incomplete'
  | 'refused'
  | 'invalid_output'
  | 'turn_limit';

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;

  /**
   * Attach a stable failure code for callers to handle independently of the message.
   */
  constructor(code: CaptureErrorCode, message: string) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
  }
}
