/** DI-токен абстракции распознавания речи: в e2e заменяется фейком. */
export const SPEECH_TRANSCRIBER = Symbol('SPEECH_TRANSCRIBER');

export interface SpeechTranscriber {
  /** Распознаёт речь в аудио/видеофайле по пути на диске и возвращает текст. */
  transcribe(inputPath: string): Promise<string>;
}
