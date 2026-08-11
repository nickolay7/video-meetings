import { Injectable } from '@nestjs/common';
import { Task, TaskSource, TaskStatus } from './task.entity';

/**
 * In-memory хранилище задач встреч: ключ — id задачи, агрегация — по meetingId.
 * По образцу MeetingsRepository.
 */
@Injectable()
export class TasksRepository {
  private tasks: Map<string, Task> = new Map();
  private idCounter = 1;

  async create(
    meetingId: string,
    title: string,
    source: TaskSource,
    assignee?: string,
  ): Promise<Task> {
    const id = String(this.idCounter++);
    const task = new Task(id, meetingId, title, source, 'open', new Date(), assignee);
    this.tasks.set(id, task);
    return task;
  }

  async findAllByMeeting(meetingId: string): Promise<Task[]> {
    return [...this.tasks.values()]
      .filter((task) => task.meetingId === meetingId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findById(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  /** Все открытые задачи всех встреч — для статического ресурса MCP-сервера. */
  async findAllOpen(): Promise<Task[]> {
    return [...this.tasks.values()].filter((task) => task.status === 'open');
  }

  /** Вставляет готовую сущность — используется автономным `mcp-server.ts` для загрузки seed-данных. */
  async insert(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
  }

  /** Мутирует статус задачи и возвращает обновлённую сущность. */
  async updateStatus(task: Task, status: TaskStatus): Promise<Task> {
    task.status = status;
    return task;
  }

  /** Обновляет переданные поля задачи (title/assignee/status) и возвращает сущность. */
  async updateTask(
    task: Task,
    fields: { title?: string; assignee?: string; status?: TaskStatus },
  ): Promise<Task> {
    if (fields.title !== undefined) task.title = fields.title;
    if (fields.assignee !== undefined) task.assignee = fields.assignee;
    if (fields.status !== undefined) task.status = fields.status;
    return task;
  }

  /** Удаляет все задачи встречи заданного источника (например, перегенерация инсайтов). */
  async removeAllForMeetingBySource(meetingId: string, source: TaskSource): Promise<void> {
    for (const [id, task] of this.tasks) {
      if (task.meetingId === meetingId && task.source === source) {
        this.tasks.delete(id);
      }
    }
  }

  async clear(): Promise<void> {
    this.tasks.clear();
    this.idCounter = 1;
  }
}
