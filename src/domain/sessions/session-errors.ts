export class InvalidSessionIdError extends Error {
  constructor() {
    super('Invalid session id')
    this.name = 'InvalidSessionIdError'
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Session has expired')
    this.name = 'SessionExpiredError'
  }
}

export class InvalidSessionTimelineError extends Error {
  constructor() {
    super('Session activity cannot precede its creation')
    this.name = 'InvalidSessionTimelineError'
  }
}
