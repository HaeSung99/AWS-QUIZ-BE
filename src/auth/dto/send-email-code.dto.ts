import { IsEmail } from 'class-validator';

// 이메일 인증코드 발송 요청을 검증하는 DTO입니다.
export class SendEmailCodeDto {
  @IsEmail()
  email: string;
}
