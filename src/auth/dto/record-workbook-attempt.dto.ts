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

export class RecordQuestionAttemptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  questionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  questionCategory: string;

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
