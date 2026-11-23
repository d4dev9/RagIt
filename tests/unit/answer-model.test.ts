import { describe, expect, it } from 'vitest'
import {
  ANSWER_MODEL_TIMEOUT_MS,
  MissingAnswerModelConfigError,
  OpenAiCompatibleAnswerModel,
} from '../../src/infrastructure/answers/openai-compatible-answer-model'

describe('OpenAiCompatibleAnswerModel', () => {
  it('exige la configuración del modelo sin exponer valores', () => {
    expect(
      () =>
        new OpenAiCompatibleAnswerModel({
          apiKey: '',
          baseUrl: '',
          model: '',
        })
    ).toThrow(MissingAnswerModelConfigError)
  })

  it('usa un tiempo límite de 60000 ms', () => {
    expect(ANSWER_MODEL_TIMEOUT_MS).toBe(60_000)
  })
})
