import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

import { PHOTO_FOLDER } from '../../users/users.constants';
import { AppEnv } from '../../config/env.validation';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly configured: boolean;

  constructor(private readonly config: ConfigService<AppEnv, true>) {
    const cloudName = this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    const apiKey = this.config.get('CLOUDINARY_API_KEY', { infer: true });
    const apiSecret = this.config.get('CLOUDINARY_API_SECRET', { infer: true });

    this.configured = Boolean(cloudName && apiKey && apiSecret);
    if (this.configured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
    }
  }

  async uploadAvatar(
    buffer: Buffer,
  ): Promise<{ url: string; publicId: string }> {
    if (!this.configured) {
      throw new ServiceUnavailableException({
        error: 'Image uploads are not configured',
      });
    }

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: PHOTO_FOLDER,
          resource_type: 'image',
          transformation: [{ width: 512, height: 512, crop: 'fill' }],
        },
        (error, uploaded) => {
          if (error || !uploaded) {
            reject(toUploadError(error));
            return;
          }
          resolve(uploaded);
        },
      );
      stream.end(buffer);
    });

    return { url: result.secure_url, publicId: result.public_id };
  }

  async deleteAsset(publicId: string): Promise<void> {
    if (!this.configured || !publicId) return;

    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'destroy failed';
      this.logger.warn(`Could not delete Cloudinary asset ${publicId}: ${message}`);
    }
  }
}

function toUploadError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Cloudinary upload failed';
  return new ServiceUnavailableException({ error: message });
}
