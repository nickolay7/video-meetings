export class MeetingFile {
  constructor(
    public readonly id: string,
    public readonly meetingId: string,
    public readonly originalName: string,
    public readonly storedName: string,
    public readonly size: number,
    public readonly mimeType: string,
    public readonly uploadedAt: Date,
  ) {}
}
