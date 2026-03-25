import { Controller, Get, Param } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('public')
export class PublicController {
  constructor(private readonly adminService: AdminService) {}

  @Get('notices')
  getNotices() {
    return this.adminService.getNotices();
  }

  @Get('workbooks')
  getWorkbooks() {
    return this.adminService.getQuestions();
  }

  @Get('workbooks/:workbookId/items')
  getWorkbookItems(@Param('workbookId') workbookId: string) {
    return this.adminService.getQuestionItems(workbookId);
  }
}
