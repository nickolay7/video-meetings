export class UpdateUserNameCommand {
  constructor(
    public readonly userId: string,
    public readonly name?: string,
  ) {}
}
