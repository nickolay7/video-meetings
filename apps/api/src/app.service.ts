import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus(): { status: string; uptime: number } {
    return {
      status: 'ok',
      uptime: process.uptime(),
    };
  }
}
