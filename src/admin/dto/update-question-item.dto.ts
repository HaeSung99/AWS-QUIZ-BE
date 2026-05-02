import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ArrayMinSize,
} from 'class-validator';

// 관리자가 기존 문항의 일부 필드만 수정할 때 입력값을 검증하는 DTO입니다.
export class UpdateQuestionItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  questionNumber?: number;

  @IsOptional()
  @IsString()
  questionDescription?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  choices?: string[];

  @IsOptional()
  @IsString()
  answer?: string;

  @IsOptional()
  @IsString()
  hint?: string;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  @IsString()
  questionCategory?: string;
}
