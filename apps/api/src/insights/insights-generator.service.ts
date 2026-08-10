import { Injectable, Logger } from '@nestjs/common';
import { ClaudeAgentService } from '../claude/claude.service';
import { InsightsRepository } from './insights.repository';
import { ActionItem, DecisionItem } from './meeting-insights.entity';

export interface InsightData {
  summary: string;
  actionItems: ActionItem[];
  decisions: DecisionItem[];
}

/**
 * Сервис генерации инсайтов из текста транскрипции через Claude Agent SDK.
 * Формирует промпт, парсит JSON-ответ, сохраняет результат в репозиторий.
 *
 * Генерации сериализуются через очередь: одновременно выполняется не более одного
 * вызова Claude (CLI-процесс), даже если несколько транскрипций завершились разом.
 */
@Injectable()
export class InsightsGeneratorService {
  private readonly logger = new Logger(InsightsGeneratorService.name);

  /** Хвост promise-цепочки очереди генерации: инсайты обрабатываются строго по одному. */
  private queueTail: Promise<void> = Promise.resolve();
  /** Поколение очереди: инкрементируется в `clear()`, чтобы завершить устаревшие джобы без записи. */
  private generation = 0;

  constructor(
    private readonly insightsRepository: InsightsRepository,
    private readonly claudeAgentService: ClaudeAgentService,
  ) {}

  /**
   * Ставит генерацию инсайтов в очередь и возвращается сразу (вызывающий код опрашивает
   * статус). Если для файла уже идёт генерация (queued/processing) — повторный запуск
   * пропускается, чтобы не запускать второй CLI-процесс.
   */
  async generate(fileId: string, meetingId: string, transcriptionText: string): Promise<void> {
    const existing = await this.insightsRepository.findByFileId(fileId);
    if (existing && (existing.status === 'queued' || existing.status === 'processing')) {
      this.logger.warn(`Insights for file ${fileId} already in progress — skipping`);
      return;
    }

    const insights = existing ?? (await this.insightsRepository.create(fileId, meetingId));
    insights.status = 'queued';
    insights.summary = undefined;
    insights.actionItems = undefined;
    insights.decisions = undefined;
    insights.error = undefined;
    await this.insightsRepository.save(insights);

    const generation = this.generation;
    this.queueTail = this.queueTail
      .then(() => this.runGeneration(fileId, meetingId, transcriptionText, generation))
      .catch((error: unknown) => {
        this.logger.error(`Insights job for file ${fileId} crashed: ${String(error)}`);
      });
  }

  /** Сбрасывает очередь и метаданные инсайтов (используется e2e-тестами). */
  async clear(): Promise<void> {
    this.generation += 1;
    this.queueTail = Promise.resolve();
    await this.insightsRepository.clear();
  }

  private async runGeneration(
    fileId: string,
    meetingId: string,
    transcriptionText: string,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation) {
      return;
    }
    const insights = await this.insightsRepository.findByFileId(fileId);
    if (!insights) {
      return;
    }

    insights.status = 'processing';
    insights.error = undefined;
    await this.insightsRepository.save(insights);

    try {
      const result = await this.claudeAgentService.run(this.buildPrompt(transcriptionText), {
        systemPrompt:
          'You are a meeting analysis assistant. Extract structured information from the meeting transcript. Always respond with valid JSON only, no other text.',
        maxTurns: 1,
      });
      if (generation !== this.generation) {
        return;
      }

      const parsed = this.parseResult(result);
      insights.status = 'completed';
      insights.summary = parsed.summary;
      insights.actionItems = parsed.actionItems;
      insights.decisions = parsed.decisions;
      await this.insightsRepository.save(insights);
      this.logger.log(`Insights for file ${fileId} generated successfully`);
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      insights.status = 'failed';
      insights.error = error instanceof Error ? error.message : String(error);
      await this.insightsRepository.save(insights);
      this.logger.error(`Insights generation for file ${fileId} failed: ${insights.error}`);
    }
  }

  private buildPrompt(transcriptionText: string): string {
    return `Analyze the following meeting transcript and extract:

1. **Summary** — a concise summary (3-5 sentences) of what was discussed, key topics, and conclusions.
2. **Action items** — a list of tasks or follow-ups mentioned, with the person responsible if specified.
3. **Decisions** — a list of decisions made during the meeting.

Respond with a valid JSON object in the following format (no other text):
{
  "summary": "string",
  "actionItems": [{ "text": "string", "assignee": "string (optional)" }],
  "decisions": [{ "text": "string" }]
}

Transcript:
${transcriptionText}`;
  }

  private parseResult(result: string): InsightData {
    // Ищем JSON-объект в ответе (на случай, если модель вернула текст до/после JSON)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse Claude response: no JSON found');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Failed to parse Claude response: invalid JSON');
    }

    if (typeof parsed.summary !== 'string') {
      throw new Error('Failed to parse Claude response: summary is missing or not a string');
    }

    const actionItems: ActionItem[] = [];
    if (Array.isArray(parsed.actionItems)) {
      for (const actionItem of parsed.actionItems) {
        if (actionItem && typeof actionItem.text === 'string') {
          actionItems.push({
            text: actionItem.text,
            assignee: typeof actionItem.assignee === 'string' ? actionItem.assignee : undefined,
          });
        }
      }
    }

    const decisions: DecisionItem[] = [];
    if (Array.isArray(parsed.decisions)) {
      for (const decision of parsed.decisions) {
        if (decision && typeof decision.text === 'string') {
          decisions.push({ text: decision.text });
        }
      }
    }

    return { summary: parsed.summary, actionItems, decisions };
  }
}
