import { describe, expect, it } from 'vitest'
import {
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
})
