import { Controller, Get, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FindUserByIdQuery } from '../users/queries/find-user-by-id.query';

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
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  async getProfile(@Req() req: AuthenticatedRequest): Promise<ProfileResponse> {
    const user = await this.queryBus.execute(new FindUserByIdQuery(req.userId!));
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { id: user.id, email: user.email, name: user.name };
  }
}
