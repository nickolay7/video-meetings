import { MeetingsRepository } from '../meetings/meetings.repository';
import { Meeting } from '../meetings/meeting.entity';

/** Встреча не найдена — инструмент мапит в `isError: true`. */
export class MeetingNotFoundError extends Error {
  constructor(meetingId: string) {
    super(`Meeting with id ${meetingId} not found`);
    this.name = 'MeetingNotFoundError';
  }
}

/** Встреча существует, но не принадлежит пользователю запроса. */
export class MeetingNotOwnedError extends Error {
  constructor(meetingId: string, userId: string) {
    super(`Meeting with id ${meetingId} does not belong to user ${userId}`);
    this.name = 'MeetingNotOwnedError';
  }
}

/**
 * Сервис владельца встречи для MCP-инструментов. `meeting_id` приходит в инпут извне,
 * поэтому перед возвратом данных нужно убедиться, что встреча принадлежит тому
 * пользователю, который делает запрос (`user_id` передаётся вместе с `meeting_id`).
 * Проверка выполняется до обращения к данным встречи (см. `findTask`/`addTask` в task-tools.ts).
 */
export class MeetingOwner {
  constructor(private readonly meetingsRepository: MeetingsRepository) {}

  /**
   * Возвращает встречу, если она существует и принадлежит userId; иначе бросает
   * `MeetingNotFoundError` / `MeetingNotOwnedError`.
   */
  async findOwnedByUser(userId: string, meetingId: string): Promise<Meeting> {
    const meeting = await this.meetingsRepository.findById(meetingId);
    if (!meeting) {
      throw new MeetingNotFoundError(meetingId);
    }
    if (meeting.ownerId !== userId) {
      throw new MeetingNotOwnedError(meetingId, userId);
    }
    return meeting;
  }
}
