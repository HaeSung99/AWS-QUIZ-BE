import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AnalyticsService } from '../analytics/analytics.service';
import { TrackVisitDto } from '../analytics/dto/track-visit.dto';
import { AdminService } from './admin.service';

@Controller('public')
export class PublicController {
  constructor(
    private readonly adminService: AdminService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Post('track-visit')
  trackVisit(@Body() dto: TrackVisitDto, @Req() req: Request) {
    const userAgent = req.headers['user-agent'];
    return this.analyticsService.trackVisit(dto, {
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  }

  @Get('notices')
  getNotices() {
    return this.adminService.getNotices();
  }

  @Get('workbooks')
  getWorkbooks() {
    return this.adminService.getPublicQuestions();
  }

  @Get('workbooks/accuracy')
  getWorkbookAccuracy() {
    return this.analyticsService.getWorkbookAccuracy();
  }

  @Get('workbooks/:workbookId/items')
  getWorkbookItems(@Param('workbookId') workbookId: string) {
    return this.adminService.getPublicQuestionItems(workbookId);
  }
}
