import Joi from 'joi';

export type AppEnv = {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  FRONTEND_URL: string;
  API_URL: string;
  MONGODB_URI: string;
  DB_NAME: string;
  REDIS_URL: string;
  REDIS_TLS: boolean;
  JWT_SECRET: string;
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
  EMAIL_FROM: string;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
};

const schema = Joi.object({
  PORT: Joi.number().port().default(5000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  FRONTEND_URL: Joi.string().default('http://localhost:3000'),
  API_URL: Joi.string().default('http://localhost:5000'),
  MONGODB_URI: Joi.string().required(),
  DB_NAME: Joi.string().default('chatwave-db'),
  REDIS_URL: Joi.string().required(),
  REDIS_TLS: Joi.boolean().default(false),
  JWT_SECRET: Joi.string().min(16).required(),
  SESSION_SECRET: Joi.string().min(16).required(),
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  GITHUB_CLIENT_ID: Joi.string().allow('').default(''),
  GITHUB_CLIENT_SECRET: Joi.string().allow('').default(''),
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  EMAIL_FROM: Joi.string().default('noreply@chatwave.app'),
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').default(''),
  CLOUDINARY_API_KEY: Joi.string().allow('').default(''),
  CLOUDINARY_API_SECRET: Joi.string().allow('').default(''),
});

function readString(
  config: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const jwtSecret = readString(config, 'JWT_SECRET', 'JWT_ACCESS_SECRET');
  const sessionSecret = readString(config, 'SESSION_SECRET') ?? jwtSecret;
  const redisTls = config.REDIS_TLS === true || config.REDIS_TLS === 'true';

  const normalized = {
    ...config,
    REDIS_TLS: redisTls,
    JWT_SECRET: jwtSecret,
    SESSION_SECRET: sessionSecret,
    CLOUDINARY_CLOUD_NAME: readString(
      config,
      'CLOUDINARY_CLOUD_NAME',
      'CLAUDINARY_CLOUD_NAME',
    ),
    CLOUDINARY_API_KEY: readString(
      config,
      'CLOUDINARY_API_KEY',
      'CLAUDINARY_API_KEY',
    ),
    CLOUDINARY_API_SECRET: readString(
      config,
      'CLOUDINARY_API_SECRET',
      'CLAUDINARY_API_SECRET',
    ),
  };

  const { error, value } = schema.validate(normalized, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });

  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }

  return value as AppEnv;
}
