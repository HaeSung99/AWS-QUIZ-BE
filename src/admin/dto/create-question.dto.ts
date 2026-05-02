import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

// 관리자가 새 문제집을 만들 때 입력값을 검증하는 DTO입니다.
export class CreateQuestionDto {
  @IsString()
  @IsNotEmpty()
  certificationType: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  summary: string;

  @IsInt()
  @Min(1)
  questionCount: number;
}
