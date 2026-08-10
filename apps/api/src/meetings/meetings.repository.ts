import { Injectable } from '@nestjs/common';
import { Meeting } from './meeting.entity';

@Injectable()
export class MeetingsRepository {
  private meetings: Map<string, Meeting> = new Map();
  private idCounter = 1;

  async create(name: string, description: string): Promise<Meeting> {
    const id = String(this.idCounter++);
    const meeting = new Meeting(id, name, description, new Date());
    this.meetings.set(id, meeting);
    return meeting;
  }

  async findAll(): Promise<Meeting[]> {
    return [...this.meetings.values()];
  }

  async findById(id: string): Promise<Meeting | undefined> {
    return this.meetings.get(id);
  }

  /** Обновляет summary встречи и возвращает обновлённую сущность. */
  async updateSummary(meeting: Meeting, summary: string): Promise<Meeting> {
    meeting.summary = summary;
    return meeting;
  }

  async clear(): Promise<void> {
    this.meetings.clear();
    this.idCounter = 1;
  }
}
