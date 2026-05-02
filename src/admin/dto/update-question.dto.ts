import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

// 관리자가 기존 문제집의 일부 필드만 수정할 때 입력값을 검증하는 DTO입니다.
export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  certificationType?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  questionCount?: number;

  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';
}
