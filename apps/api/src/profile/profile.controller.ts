import { Controller, Get, Patch, Body, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FindUserByIdQuery } from '../users/queries/find-user-by-id.query';
import { UpdateUserNameCommand } from '../users/commands/update-user-name.command';
import { UpdateProfileDto } from './dto/update-profile.dto';

interface AuthenticatedRequest {
  userId?: string;
}

interface ProfileResponse {
  id: string;
  email: string;
  name?: string;
}

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get()
  async getProfile(@Req() req: AuthenticatedRequest): Promise<ProfileResponse> {
    const user = await this.queryBus.execute(new FindUserByIdQuery(req.userId!));
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { id: user.id, email: user.email, name: user.name };
  }

  @Patch()
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const user = await this.commandBus.execute(
      new UpdateUserNameCommand(req.userId!, dto.name || undefined),
    );
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { id: user.id, email: user.email, name: user.name };
  }
}
