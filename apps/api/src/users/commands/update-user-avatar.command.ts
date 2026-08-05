export class UpdateUserAvatarCommand {
  constructor(
    public readonly userId: string,
    public readonly avatarPath: string,
    public readonly avatarMimeType: string,
  ) {}
}
