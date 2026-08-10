/** Статусы задачи встречи. */
export type TaskStatus = 'open' | 'completed';

/** Источник появления задачи (откуда она взялась). */
export type TaskSource = 'insights' | 'manual';

export class Task {
  constructor(
    public readonly id: string,
    public readonly meetingId: string,
    public title: string,
    public readonly source: TaskSource,
    public status: TaskStatus,
    public readonly createdAt: Date,
    public assignee?: string,
  ) {}
}
