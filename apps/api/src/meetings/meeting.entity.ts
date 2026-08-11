export class Meeting {
  constructor(
    public readonly id: string,
    /** Идентификатор пользователя-владельца встречи (из JWT при создании). */
    public readonly ownerId: string,
    public readonly name: string,
    public readonly description: string,
    public readonly createdAt: Date,
    public summary?: string,
  ) {}
}
