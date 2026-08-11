/** Статусы генерации инсайтов встречи. */
export type InsightsStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ActionItem {
  text: string;
  assignee?: string;
}

export interface DecisionItem {
  text: string;
}

export class MeetingInsights {
  constructor(
    public readonly fileId: string,
    public readonly meetingId: string,
    public status: InsightsStatus,
    public readonly createdAt: Date,
    public summary?: string,
    public actionItems?: ActionItem[],
    public decisions?: DecisionItem[],
    public error?: string,
  ) {}
}
