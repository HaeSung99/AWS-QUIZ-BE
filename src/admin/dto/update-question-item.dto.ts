import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ArrayMinSize,
} from 'class-validator';

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
