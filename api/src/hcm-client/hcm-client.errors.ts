export class HcmValidationError extends Error {
  constructor(message: string, public readonly hcmResponse: any) {
    super(message);
    this.name = 'HcmValidationError';
  }
}

export class HcmUnavailableError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'HcmUnavailableError';
  }
}
