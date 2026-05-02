import { IsString, MinLength } from 'class-validator';

// 로그인한 사용자의 비밀번호 변경 요청을 검증하는 DTO입니다.
export class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  currentPassword: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}
