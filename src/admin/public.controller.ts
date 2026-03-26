import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
  trackVisit(@Body() dto: TrackVisitDto) {
    return this.analyticsService.trackVisit(dto);
  }

  @Get('notices')
  getNotices() {
    return this.adminService.getNotices();
  }

  @Get('workbooks')
  getWorkbooks() {
    return this.adminService.getQuestions();
  }

  @Get('workbooks/accuracy')
  getWorkbookAccuracy() {
    return this.analyticsService.getWorkbookAccuracy();
  }

  @Get('workbooks/:workbookId/items')
  getWorkbookItems(@Param('workbookId') workbookId: string) {
    return this.adminService.getQuestionItems(workbookId);
  }
}
