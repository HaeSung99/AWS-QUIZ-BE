import { IsBoolean, IsOptional, IsString } from 'class-validator';

// 관리자가 기존 공지사항의 일부 필드만 수정할 때 입력값을 검증하는 DTO입니다.
export class UpdateNoticeDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}
