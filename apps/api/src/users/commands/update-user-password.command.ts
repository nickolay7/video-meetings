export class UpdateUserPasswordCommand {
  constructor(
    public readonly userId: string,
    public readonly hashedPassword: string,
  ) {}
}
