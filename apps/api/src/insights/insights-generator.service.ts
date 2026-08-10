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
 */
@Injectable()
export class InsightsGeneratorService {
  private readonly logger = new Logger(InsightsGeneratorService.name);

  constructor(
    private readonly insightsRepository: InsightsRepository,
    private readonly claudeAgentService: ClaudeAgentService,
  ) {}

  /**
   * Генерирует инсайты для указанного файла из текста транскрипции.
   * Статус проходит: queued → processing → completed/failed.
   */
  async generate(fileId: string, meetingId: string, transcriptionText: string): Promise<void> {
    let insights = await this.insightsRepository.findByFileId(fileId);
    if (!insights) {
      insights = await this.insightsRepository.create(fileId, meetingId);
    } else {
      insights.status = 'queued';
      insights.summary = undefined;
      insights.actionItems = undefined;
      insights.decisions = undefined;
      insights.error = undefined;
      await this.insightsRepository.save(insights);
    }

    insights.status = 'processing';
    await this.insightsRepository.save(insights);

    try {
      const result = await this.claudeAgentService.run(this.buildPrompt(transcriptionText), {
        systemPrompt:
          'You are a meeting analysis assistant. Extract structured information from the meeting transcript. Always respond with valid JSON only, no other text.',
        maxTurns: 1,
      });

      const parsed = this.parseResult(result);
      insights.status = 'completed';
      insights.summary = parsed.summary;
      insights.actionItems = parsed.actionItems;
      insights.decisions = parsed.decisions;
      await this.insightsRepository.save(insights);
      this.logger.log(`Insights for file ${fileId} generated successfully`);
    } catch (error) {
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
      for (const item of parsed.actionItems) {
        if (item && typeof item.text === 'string') {
          actionItems.push({
            text: item.text,
            assignee: typeof item.assignee === 'string' ? item.assignee : undefined,
          });
        }
      }
    }

    const decisions: DecisionItem[] = [];
    if (Array.isArray(parsed.decisions)) {
      for (const item of parsed.decisions) {
        if (item && typeof item.text === 'string') {
          decisions.push({ text: item.text });
        }
      }
    }

    return { summary: parsed.summary, actionItems, decisions };
  }
}
