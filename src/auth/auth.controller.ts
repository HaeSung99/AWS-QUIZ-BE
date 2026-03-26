import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RecordWorkbookAttemptDto } from './dto/record-workbook-attempt.dto';
import { SendEmailCodeDto } from './dto/send-email-code.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyEmailCodeDto } from './dto/verify-email-code.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtPayload } from './jwt.strategy';

type RequestWithUser = Request & { user: JwtPayload };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('email/send-code')
  sendEmailCode(@Body() dto: SendEmailCodeDto) {
    return this.authService.sendEmailCode(dto);
  }

  @Post('email/verify')
  verifyEmailCode(@Body() dto: VerifyEmailCodeDto) {
    return this.authService.verifyEmailCode(dto);
  }

  @Post('signup')
  signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: RequestWithUser) {
    return this.authService.getProfile(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/solved-workbooks/:workbookId')
  markSolved(
    @Req() req: RequestWithUser,
    @Param('workbookId') workbookId: string,
  ) {
    return this.authService.markWorkbookSolved(req.user.sub, workbookId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/workbook-attempts')
  recordWorkbookAttempt(
    @Req() req: RequestWithUser,
    @Body() dto: RecordWorkbookAttemptDto,
  ) {
    return this.authService.recordWorkbookAttempt(req.user.sub, dto);
  }
}
