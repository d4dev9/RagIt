export class InvalidQuestionError extends Error {
  constructor() {
    super('La pregunta está vacía o excede el máximo permitido')
    this.name = 'InvalidQuestionError'
  }
}
