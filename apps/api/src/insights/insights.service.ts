import { Injectable } from '@nestjs/common';
import { ActionItem, DecisionItem } from './meeting-insights.entity';

export interface InsightData {
  summary: string;
  actionItems: ActionItem[];
  decisions: DecisionItem[];
}

/**
 * Сервис инсайтов — заглушка для Phase 1.
 * Полная реализация с генерацией через Claude будет в Phase 2.
 */
@Injectable()
export class InsightsService {
  // Методы генерации будут добавлены в Phase 2 (InsightsGeneratorService).
}
