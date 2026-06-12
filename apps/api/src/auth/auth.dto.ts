import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @Length(3, 30)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'username: letters, numbers, _ . - only' })
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  countryCode?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(32)
  refreshToken!: string;
}

export class MfaLoginDto {
  @IsString()
  mfaToken!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class MfaCodeDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}
