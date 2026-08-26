import { setDefaultResultOrder } from 'node:dns';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppEnv } from './config/env.validation';
import { frontendOrigins } from './config/cors.origins';
import { SocketSessionAdapter } from './messages/adapters/socket-session.adapter';

setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = (await NestFactory.create(AppModule)) as NestExpressApplication;
  const config = app.get(ConfigService<AppEnv, true>);
  const port = config.get('PORT', { infer: true });
  const frontendUrl = config.get('FRONTEND_URL', { infer: true });
  const origins = frontendOrigins(frontendUrl);

  app.enableShutdownHooks();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api', { exclude: ['/'] });
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useWebSocketAdapter(new SocketSessionAdapter(app, origins));

  await app.listen(port, '0.0.0.0');
  console.log(`Server is running at http://0.0.0.0:${port}`);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
