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
