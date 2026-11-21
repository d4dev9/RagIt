export interface AnswerModelRequest {
  readonly systemPrompt: string
  readonly userPrompt: string
}

export interface AnswerModel {
  answer(request: AnswerModelRequest): Promise<string>
}
