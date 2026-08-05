import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { Readable } from 'stream';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FindUserByIdQuery } from '../users/queries/find-user-by-id.query';
import { UpdateUserNameCommand } from '../users/commands/update-user-name.command';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ProfileService } from './profile.service';
import { MAX_AVATAR_SIZE } from './profile.constants';

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
    private readonly profileService: ProfileService,
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
      new UpdateUserNameCommand(req.userId!, dto.name?.trim() || undefined),
    );
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { id: user.id, email: user.email, name: user.name };
  }

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_SIZE },
    }),
  )
  async uploadAvatar(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ProfileResponse> {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const user = await this.profileService.saveAvatar(req.userId!, file);
    return { id: user.id, email: user.email, name: user.name };
  }

  @Get('avatar')
  async getAvatar(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { mimeType, content } = await this.profileService.getAvatar(req.userId!);
    res.set({ 'Content-Type': mimeType, 'Content-Length': String(content.length) });
    return new StreamableFile(Readable.from(content));
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ status: string }> {
    await this.profileService.changePassword(req.userId!, dto.oldPassword, dto.newPassword);
    return { status: 'ok' };
  }
}
