import { IsEmail, IsString, Length } from 'class-validator';

// 이메일과 6자리 인증코드 확인 요청을 검증하는 DTO입니다.
export class VerifyEmailCodeDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
