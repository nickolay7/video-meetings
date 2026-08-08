import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readFile, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SpeechTranscriber } from './speech-transcriber.interface';
import { getWhisperCommand, getWhisperModel, getWhisperTimeoutMs } from './transcription.constants';

const execFileAsync = promisify(execFile);

/**
 * Реальная реализация SpeechTranscriber: обёртка над локальным CLI Whisper через
 * `child_process` (`execFile`). По умолчанию команда — `whisper` (openai-whisper),
 * аргументы настроены под неё; переопределяется через `WHISPER_COMMAND`.
 *
 * Модель (base/low) задаётся через `WHISPER_MODEL` и загружается ЛЕНИВО: CLI сам
 * скачивает/кеширует модель при первом вызове, поэтому при старте приложения ничего
 * не тянется — e2e-тесты с замоканным транскрибатором модель не трогают.
 */
@Injectable()
export class WhisperTranscriber implements SpeechTranscriber {
  private readonly logger = new Logger(WhisperTranscriber.name);
  private modelReady = false;

  async transcribe(inputPath: string): Promise<string> {
    if (!this.modelReady) {
      this.logger.log(
        `Whisper: первая транскрибация — модель "${getWhisperModel()}" будет загружена CLI лениво`,
      );
    }

    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'whisper-'));
    const command = getWhisperCommand();
    const args = [
      inputPath,
      '--model',
      getWhisperModel(),
      '--output_format',
      'txt',
      '--output_dir',
      outputDir,
      '--fp16',
      'False',
    ];

    const timeoutMs = getWhisperTimeoutMs();
    try {
      await execFileAsync(command, args, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: timeoutMs,
      });
      const outputFile = path.join(
        outputDir,
        `${path.basename(inputPath, path.extname(inputPath))}.txt`,
      );
      const text = (await readFile(outputFile, 'utf8')).trim();
      if (!this.modelReady) {
        this.modelReady = true;
        this.logger.log(`Whisper: модель "${getWhisperModel()}" готова`);
      }
      return text;
    } catch (error) {
      // При таймауте execFile убивает процесс и оставляет пустое сообщение об ошибке —
      // зависший CLI распознаём по флагу `killed` и отдаём понятную причину.
      const execError = error as Error & { killed?: boolean };
      const timedOut = execError?.killed === true;
      const reason = error instanceof Error ? error.message.trim() : String(error);
      const detail = timedOut ? `timed out after ${timeoutMs} ms` : reason || 'unknown error';
      throw new Error(`Whisper transcription failed: ${detail}`);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
}
