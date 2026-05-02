import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// 관리자가 새 공지사항을 등록할 때 입력값을 검증하는 DTO입니다.
export class CreateNoticeDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  pinned?: boolean;
}
