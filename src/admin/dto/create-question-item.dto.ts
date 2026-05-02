import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// 관리자가 문제집 안에 새 문항을 추가할 때 입력값을 검증하는 DTO입니다.
export class CreateQuestionItemDto {
  @IsInt()
  @Min(1)
  questionNumber: number;

  @IsString()
  @IsNotEmpty()
  questionDescription: string;

  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  choices: string[];

  @IsString()
  @IsNotEmpty()
  answer: string;

  @IsOptional()
  @IsString()
  hint?: string;

  @IsString()
  @IsNotEmpty()
  difficulty: string;

  @IsString()
  @IsNotEmpty()
  questionCategory: string;
}
