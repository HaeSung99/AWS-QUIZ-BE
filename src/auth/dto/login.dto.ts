import { IsEmail, IsString, MinLength } from 'class-validator';

// 로그인 요청 바디를 검증하는 DTO입니다.
export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
