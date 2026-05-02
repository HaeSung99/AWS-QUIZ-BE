import { IsEmail, IsString, MinLength } from 'class-validator';

// 이메일 인증 완료 후 새 비밀번호 재설정 요청을 검증하는 DTO입니다.
export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}
