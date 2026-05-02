import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// 개별 문항 풀이 결과를 약점 분석용으로 저장할 때 검증하는 DTO입니다.
export class RecordQuestionAttemptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  questionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  questionCategory: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  certificationType?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  difficulty: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  selectedAnswer?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  correctAnswer: string;

  @IsBoolean()
  isCorrect: boolean;
}

// 한 번의 퀴즈 제출 결과와 문항별 풀이 기록을 함께 검증하는 DTO입니다.
export class RecordWorkbookAttemptDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  workbookId?: string;

  @IsInt()
  @Min(0)
  correctCount: number;

  @IsInt()
  @Min(1)
  @Max(1000)
  totalCount: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => RecordQuestionAttemptDto)
  questionAttempts?: RecordQuestionAttemptDto[];
}
