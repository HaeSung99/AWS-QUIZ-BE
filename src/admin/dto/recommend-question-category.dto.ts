import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// 관리자 화면에서 선택 가능한 문제 카테고리 옵션을 검증하는 DTO입니다.
export class QuestionCategoryOptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  value: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  keywords?: string[];
}

// 작성 중인 문항을 기존 임베딩과 비교해 카테고리 추천을 요청할 때 검증하는 DTO입니다.
export class RecommendQuestionCategoryDto {
  @IsString()
  @IsNotEmpty()
  questionDescription: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuestionCategoryOptionDto)
  categories: QuestionCategoryOptionDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  choices?: string[];

  @IsString()
  @IsOptional()
  answer?: string;

  @IsString()
  @IsOptional()
  hint?: string;

  @IsString()
  @IsOptional()
  difficulty?: string;
}
